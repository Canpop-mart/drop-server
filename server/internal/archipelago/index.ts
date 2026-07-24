/*
Manages Archipelago multiworld sessions.

Division of labour: the Archipelago WebHost (a separate container) owns YAML
option schemas, generation, room hosting and trackers — all things it already
does well for ~115 games. Drop owns the parts WebHost has no concept of:

  - reachability — WebHost is bound to the NAS, so remote players need a route
    to it. We put the server itself on a ZeroTier overlay (see ensureNetwork).
  - collection   — everyone's YAML in one place, validated, with a readiness
    list, instead of the host chasing people for files.
  - distribution — one connect string handed to everybody.

Unlike co-op rooms (../zerotier) this uses ONE long-lived network rather than
one per session, because Archipelago reads `HOST_ADDRESS` from a config file at
startup: the server's overlay IP has to be stable or that value goes stale.
Sessions are told apart by Archipelago's per-room port instead.

Follows the manager-singleton pattern. Controller HTTP calls live in
../zerotier/controller; this layer owns the DB + business rules.
*/

import { randomBytes } from "node:crypto";
import { parseAllDocuments } from "yaml";
import prisma from "../db/database";
import { systemConfig } from "../config/sys-conf";
import { zerotierController } from "../zerotier/controller";
import { logger } from "../logging";

// Same ambiguity-free alphabet as co-op rooms so codes read out loud cleanly.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

// Distinct from co-op's 10.242.x so the two overlays can never collide. Only one
// Archipelago network ever exists, so the third octet is fixed rather than
// allocated.
const AP_SUBNET = "10.243.0";
const AP_SUBNET_OCTET = 0;

// The singleton row's primary key (mirrors the schema default).
const NETWORK_ROW_ID = "singleton";

// ZeroTier hands out addresses asynchronously after a join, so the IP usually
// isn't there on the first read. Poll briefly; if it still hasn't landed we
// persist null and resolve on a later call rather than failing the request.
const IP_POLL_ATTEMPTS = 6;
const IP_POLL_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prisma unique-constraint violation — used to retry a raced allocation. */
function isUniqueConstraintError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

export interface YamlSummary {
  /** Slot names declared in the file (a YAML may hold several players). */
  slotNames: string[];
  /** Human-readable game label(s) — `game` may be a weighted map, not a string. */
  games: string[];
}

/**
 * Structurally validate an uploaded YAML. This is deliberately NOT a full
 * Archipelago option check (that needs AP's Python world definitions); it
 * catches the cheap failures that otherwise surface as a generation crash after
 * everyone has already submitted:
 *   - unparseable YAML
 *   - a missing `name` or `game`
 * Cross-slot duplicate names are caught separately in `upsertSlotYaml`, since
 * that needs the whole session.
 */
export function summariseYaml(text: string): YamlSummary {
  if (!text.trim())
    throw createError({ statusCode: 400, statusMessage: "The file is empty." });

  let docs;
  try {
    docs = parseAllDocuments(text);
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: `That isn't valid YAML: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const slotNames: string[] = [];
  const games: string[] = [];

  for (const doc of docs) {
    if (doc.errors?.length)
      throw createError({
        statusCode: 400,
        statusMessage: `That isn't valid YAML: ${doc.errors[0].message}`,
      });

    const value = doc.toJS() as Record<string, unknown> | null;
    // A trailing `---` produces an empty document; ignore rather than reject.
    if (!value || typeof value !== "object") continue;

    const name = value.name;
    if (typeof name !== "string" || !name.trim())
      throw createError({
        statusCode: 400,
        statusMessage: "The YAML is missing a `name` (your slot name).",
      });

    // `game` is either a single game or a weighted map of games to pick from.
    const game = value.game;
    let label: string;
    if (typeof game === "string" && game.trim()) label = game;
    else if (game && typeof game === "object" && Object.keys(game).length > 0)
      label = Object.keys(game).join(", ");
    else
      throw createError({
        statusCode: 400,
        statusMessage: "The YAML is missing a `game`.",
      });

    slotNames.push(name.trim());
    games.push(label);
  }

  if (slotNames.length === 0)
    throw createError({
      statusCode: 400,
      statusMessage: "No player settings were found in that file.",
    });

  return { slotNames, games };
}

class ArchipelagoManager {
  isEnabled() {
    return systemConfig.isZerotierEnabled();
  }

  private ensureEnabled() {
    if (!this.isEnabled())
      throw createError({
        statusCode: 503,
        statusMessage:
          "Archipelago sessions need ZeroTier, which isn't enabled on this server.",
      });
  }

  private generateCode() {
    const bytes = randomBytes(CODE_LENGTH);
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++)
      out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  private async allocateUniqueCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = this.generateCode();
      const existing = await prisma.archipelagoSession.findUnique({
        where: { shortCode: code },
      });
      if (!existing) return code;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Could not allocate a unique session code.",
    });
  }

  /**
   * The server's own IPv4 on the overlay. Prefers the controller's assignment
   * (its intent) and falls back to the node's own view, since the two converge
   * a moment apart.
   */
  private async resolveServerAddress(
    networkId: string,
  ): Promise<string | undefined> {
    const nodeId = await zerotierController.getControllerNodeId();
    const isV4 = (a: string) => /^\d+\.\d+\.\d+\.\d+/.test(a);

    for (let attempt = 0; attempt < IP_POLL_ATTEMPTS; attempt++) {
      const assigned = await zerotierController
        .getMemberIpAssignments(networkId, nodeId)
        .catch(() => [] as string[]);
      const fromController = assigned.find(isV4);
      if (fromController) return fromController.split("/")[0];

      const membership = await zerotierController.getJoinedNetwork(networkId);
      const fromNode = (membership?.assignedAddresses ?? []).find(isV4);
      if (fromNode) return fromNode.split("/")[0];

      await sleep(IP_POLL_DELAY_MS);
    }
    return undefined;
  }

  /**
   * The shared Archipelago overlay network, created on first use. Idempotent:
   * safe to call on every session create, and it re-resolves the server address
   * if a previous attempt raced ZeroTier's async assignment.
   */
  async ensureNetwork() {
    this.ensureEnabled();

    const existing = await prisma.archipelagoNetwork.findUnique({
      where: { id: NETWORK_ROW_ID },
    });

    if (existing) {
      if (existing.serverAddress) return existing;
      // Joined previously but the IP hadn't landed yet — try again.
      const serverAddress = await this.resolveServerAddress(existing.networkId);
      if (!serverAddress) return existing;
      return await prisma.archipelagoNetwork.update({
        where: { id: NETWORK_ROW_ID },
        data: { serverAddress },
      });
    }

    let networkId: string | undefined;
    try {
      networkId = await zerotierController.createNetwork({
        name: "drop-archipelago",
        private: true,
        enableBroadcast: true,
        v4AssignMode: { zt: true },
        ipAssignmentPools: [
          { ipRangeStart: `${AP_SUBNET}.1`, ipRangeEnd: `${AP_SUBNET}.254` },
        ],
        routes: [{ target: `${AP_SUBNET}.0/24`, via: null }],
      });

      // The server has to be BOTH authorized (we're the controller, so we
      // authorize our own node id) and actually joined — authorization alone
      // leaves it off the overlay, which is the state co-op rooms live in.
      const nodeId = await zerotierController.getControllerNodeId();
      await zerotierController.setMemberAuthorized(networkId, nodeId, true);
      await zerotierController.joinNetwork(networkId);

      const serverAddress = await this.resolveServerAddress(networkId);
      if (!serverAddress)
        logger.warn(
          `[Archipelago] network ${networkId} created but no overlay IP yet; will resolve on a later call`,
        );

      return await prisma.archipelagoNetwork.create({
        data: {
          id: NETWORK_ROW_ID,
          networkId,
          subnetOctet: AP_SUBNET_OCTET,
          serverAddress,
        },
      });
    } catch (e) {
      // Lost a race to another request: reuse the winner's network and drop the
      // one we minted so the controller isn't left with an orphan.
      if (isUniqueConstraintError(e)) {
        if (networkId)
          await zerotierController.leaveNetwork(networkId).catch(() => {});
        if (networkId)
          await zerotierController.deleteNetwork(networkId).catch(() => {});
        const winner = await prisma.archipelagoNetwork.findUnique({
          where: { id: NETWORK_ROW_ID },
        });
        if (winner) return winner;
      }
      if (networkId)
        await zerotierController.deleteNetwork(networkId).catch(() => {});
      throw e;
    }
  }

  /**
   * Authorize a player's device onto the shared overlay.
   *
   * Note we never de-authorize on leave, unlike co-op rooms: the Archipelago
   * network is one persistent overlay for the whole group, so a member could be
   * in another session on it. Membership is of the network, not the session.
   */
  private async authorizeMember(networkId: string, nodeId: string) {
    await zerotierController.setMemberAuthorized(networkId, nodeId, true);
  }

  /** Start a session and put the host in it as the first slot. */
  async createSession(opts: {
    hostClientId: string;
    hostNodeId: string;
    name?: string;
  }) {
    this.ensureEnabled();
    const network = await this.ensureNetwork();
    await this.authorizeMember(network.networkId, opts.hostNodeId);

    for (let attempt = 0; attempt < 8; attempt++) {
      const shortCode = await this.allocateUniqueCode();
      try {
        const session = await prisma.archipelagoSession.create({
          data: {
            shortCode,
            name: opts.name,
            hostClientId: opts.hostClientId,
            slots: { create: { clientId: opts.hostClientId } },
          },
        });
        return { session, network };
      } catch (e) {
        if (isUniqueConstraintError(e)) continue;
        throw e;
      }
    }

    throw createError({
      statusCode: 503,
      statusMessage: "Could not start a session right now — please try again.",
    });
  }

  /** Join by short code. Re-joining a session you're already in is a no-op. */
  async joinSession(opts: {
    shortCode: string;
    clientId: string;
    nodeId: string;
  }) {
    this.ensureEnabled();
    const network = await this.ensureNetwork();

    const session = await prisma.archipelagoSession.findUnique({
      where: { shortCode: opts.shortCode.toUpperCase() },
    });
    if (!session)
      throw createError({ statusCode: 404, statusMessage: "session_not_found" });
    if (session.status === "Closed")
      throw createError({
        statusCode: 410,
        statusMessage: "That session has been closed.",
      });

    await this.authorizeMember(network.networkId, opts.nodeId);

    await prisma.archipelagoSlot.upsert({
      where: {
        sessionId_clientId: { sessionId: session.id, clientId: opts.clientId },
      },
      create: { sessionId: session.id, clientId: opts.clientId },
      update: {},
    });

    return { session, network };
  }

  /** Full detail for the session view: slots, readiness, connect info. */
  async getSession(sessionId: string, requestingClientId: string) {
    const session = await prisma.archipelagoSession.findUnique({
      where: { id: sessionId },
      include: {
        slots: {
          include: { client: { select: { id: true, name: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    });
    if (!session)
      throw createError({ statusCode: 404, statusMessage: "session_not_found" });

    const isMember = session.slots.some(
      (s) => s.clientId === requestingClientId,
    );
    if (!isMember && session.hostClientId !== requestingClientId)
      throw createError({
        statusCode: 403,
        statusMessage: "You're not in this session.",
      });

    const network = await prisma.archipelagoNetwork.findUnique({
      where: { id: NETWORK_ROW_ID },
    });

    const slots = session.slots.map((s) => ({
      clientId: s.clientId,
      clientName: s.client.name,
      slotName: s.slotName,
      game: s.game,
      hasYaml: !!s.yamlText,
      validationError: s.validationError,
      uploadedAt: s.uploadedAt,
      isHost: s.clientId === session.hostClientId,
      isSelf: s.clientId === requestingClientId,
    }));

    const ready = slots.filter((s) => s.hasYaml && !s.validationError).length;

    return {
      sessionId: session.id,
      shortCode: session.shortCode,
      name: session.name,
      status: session.status,
      connectAddress: session.connectAddress,
      networkId: network?.networkId ?? null,
      serverAddress: network?.serverAddress ?? null,
      isHost: session.hostClientId === requestingClientId,
      slots,
      readyCount: ready,
      totalCount: slots.length,
      allReady: slots.length > 0 && ready === slots.length,
    };
  }

  /**
   * Store a member's YAML. Validates structure, then checks the slot name
   * against every other slot in the session — a duplicate name fails generation
   * for everyone, and holding all the files centrally is the only reason we can
   * catch it before the host finds out the hard way.
   */
  async upsertSlotYaml(opts: {
    sessionId: string;
    clientId: string;
    yamlText: string;
  }) {
    const slot = await prisma.archipelagoSlot.findUnique({
      where: {
        sessionId_clientId: {
          sessionId: opts.sessionId,
          clientId: opts.clientId,
        },
      },
    });
    if (!slot)
      throw createError({
        statusCode: 403,
        statusMessage: "You're not in this session.",
      });

    const summary = summariseYaml(opts.yamlText);

    const others = await prisma.archipelagoSlot.findMany({
      where: {
        sessionId: opts.sessionId,
        clientId: { not: opts.clientId },
        slotName: { not: null },
      },
      select: { slotName: true },
    });
    const taken = new Set(
      others.flatMap((o) => (o.slotName ? o.slotName.split(", ") : [])),
    );
    const clash = summary.slotNames.find((n) => taken.has(n));
    if (clash)
      throw createError({
        statusCode: 409,
        statusMessage: `The slot name "${clash}" is already used by someone else in this session. Pick a different \`name\`.`,
      });

    return await prisma.archipelagoSlot.update({
      where: {
        sessionId_clientId: {
          sessionId: opts.sessionId,
          clientId: opts.clientId,
        },
      },
      data: {
        yamlText: opts.yamlText,
        slotName: summary.slotNames.join(", "),
        game: summary.games.join(", "),
        validationError: null,
        uploadedAt: new Date(),
      },
    });
  }

  /**
   * Every valid slot's YAML concatenated into one multi-document file, which is
   * what the host uploads to WebHost's Generate page. Archipelago treats `---`
   * separated documents as separate players, so this stays a single upload.
   *
   * The stored text is emitted verbatim rather than re-serialised: game-specific
   * options can be order- or anchor-sensitive and round-tripping them through a
   * YAML writer risks changing meaning.
   */
  async buildBundle(sessionId: string) {
    const session = await prisma.archipelagoSession.findUnique({
      where: { id: sessionId },
      include: { slots: { orderBy: { joinedAt: "asc" } } },
    });
    if (!session)
      throw createError({ statusCode: 404, statusMessage: "session_not_found" });

    const usable = session.slots.filter((s) => s.yamlText && !s.validationError);
    if (usable.length === 0)
      throw createError({
        statusCode: 400,
        statusMessage: "Nobody has uploaded a valid YAML yet.",
      });

    const body = usable
      .map((s) => (s.yamlText ?? "").trim())
      .join("\n---\n")
      .concat("\n");

    const safeName = (session.name ?? session.shortCode).replace(
      /[^a-zA-Z0-9-_]/g,
      "_",
    );

    return { filename: `archipelago-${safeName}.yaml`, body };
  }

  /** Host records the `/connect ip:port` string from the Archipelago room page. */
  async setConnectAddress(opts: {
    sessionId: string;
    clientId: string;
    connectAddress: string;
  }) {
    const session = await prisma.archipelagoSession.findUnique({
      where: { id: opts.sessionId },
    });
    if (!session)
      throw createError({ statusCode: 404, statusMessage: "session_not_found" });
    if (session.hostClientId !== opts.clientId)
      throw createError({
        statusCode: 403,
        statusMessage: "Only the host can set the connect address.",
      });

    // Accept what the room page shows ("/connect 10.243.0.1:38286") as well as a
    // bare host:port, so the host can paste either.
    const cleaned = opts.connectAddress.trim().replace(/^\/connect\s+/i, "");
    if (!/^[^\s:]+:\d{1,5}$/.test(cleaned))
      throw createError({
        statusCode: 400,
        statusMessage: "That should look like `10.243.0.1:38281`.",
      });

    return await prisma.archipelagoSession.update({
      where: { id: opts.sessionId },
      data: { connectAddress: cleaned, status: "Running" },
    });
  }

  /**
   * Leave a session. The host leaving closes it for everyone (mirrors co-op
   * rooms, where the host ending it dissolves the room).
   */
  async leaveSession(opts: { sessionId: string; clientId: string }) {
    const session = await prisma.archipelagoSession.findUnique({
      where: { id: opts.sessionId },
    });
    if (!session) return;

    if (session.hostClientId === opts.clientId) {
      await prisma.archipelagoSession.update({
        where: { id: opts.sessionId },
        data: { status: "Closed" },
      });
      return;
    }

    await prisma.archipelagoSlot
      .delete({
        where: {
          sessionId_clientId: {
            sessionId: opts.sessionId,
            clientId: opts.clientId,
          },
        },
      })
      .catch(() => {});
  }

  /** Sessions this client is in, newest first (for the "resume" list). */
  async listForClient(clientId: string) {
    const sessions = await prisma.archipelagoSession.findMany({
      where: { status: { not: "Closed" }, slots: { some: { clientId } } },
      include: { slots: { select: { clientId: true } } },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((s) => ({
      sessionId: s.id,
      shortCode: s.shortCode,
      name: s.name,
      status: s.status,
      connectAddress: s.connectAddress,
      memberCount: s.slots.length,
      isHost: s.hostClientId === clientId,
      createdAt: s.createdAt,
    }));
  }
}

export const archipelagoManager = new ArchipelagoManager();
export default archipelagoManager;
