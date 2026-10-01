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

DECISION PENDING (owner): how players reach the Archipelago server.

  (A) Directly: the archipelago service publishes its ports on the NAS (LAN or
      public IP / DNS). Then this overlay is unnecessary for Archipelago and
      would be removed: ensureNetwork, authorizeMember/deauthorizeIfUnused,
      reconcileMembers, resolveServerAddress/checkServerAddress and the
      ArchipelagoNetwork row here; the `zerotierNodeId` in the create/join
      routes; on the client the ZeroTier half of ap_session_create/join/leave,
      the ap_network_id cache, ap_keep and the Archipelago parts of the startup
      and post-join sweeps in src-tauri/src/zerotier.rs. The connect address
      becomes the NAS host/DNS name plus the room port, which is what the
      WebHost room page already shows when its HOST_ADDRESS is set to that name.

  (B) Only over the overlay: the archipelago service must share the ZeroTier
      node's network namespace (e.g. `network_mode: service:zerotier-controller`
      in compose, and the controller then needs /dev/net/tun and NET_ADMIN,
      which the shipped compose comments say it does not have), so the address
      the node holds on this network is the address Archipelago listens on.
      The address shown to the host must be the one the node really holds after
      joining, never the controller's intended assignment.

Neither is implemented. What is here regardless: the server address is only
reported as verified when the node itself holds it (status OK), and members
are de-authorized when they stop being in any open session.
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

const sessionClosedError = () =>
  createError({
    statusCode: 410,
    statusMessage: "That session has been closed.",
  });

// ZeroTier hands out addresses asynchronously after a join, so the IP usually
// isn't there on the first read. Poll briefly; if it still hasn't landed we
// persist null and resolve on a later call rather than failing the request.
const IP_POLL_ATTEMPTS = 6;
const IP_POLL_DELAY_MS = 500;

// getSession is polled every few seconds by every member; the live "does the
// node really hold this address" check is a local controller call, so cache
// it briefly rather than making one per poll. A miss is remembered for the
// same window, so create/join don't each repeat ensureNetwork's ~3s poll.
const ADDRESS_CHECK_TTL_MS = 15_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A Setup session with no YAML uploaded and no member activity for this long is closed. */
export const SETUP_STALE_MS = 30 * DAY_MS;
/**
 * The same, for a Setup session where someone has uploaded a YAML. Longer,
 * because such a session may already be generated and played with the connect
 * address shared outside Drop, which Drop only sees when a member opens it.
 */
export const SETUP_WITH_YAML_STALE_MS = 90 * DAY_MS;
/** Opening or polling a session moves `lastActivityAt` forward at most this often. */
const VIEW_ACTIVITY_INTERVAL_MS = HOUR_MS;
/** A Closed session is deleted (with its slots and YAMLs) this long after closing. */
export const CLOSED_PURGE_MS = 30 * DAY_MS;

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

const isV4 = (a: string) => /^\d+\.\d+\.\d+\.\d+/.test(a);

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

/**
 * The slot names a stored slot declares. Re-parsed from the stored YAML rather
 * than split out of the display column, because a slot name may itself contain
 * the ", " that column joins names with. Falls back to the display column as a
 * single name only if the stored YAML no longer parses (it was validated on
 * upload, so that shouldn't happen).
 */
export function storedSlotNames(slot: {
  yamlText: string | null;
  slotName: string | null;
}): string[] {
  if (slot.yamlText) {
    try {
      return summariseYaml(slot.yamlText).slotNames;
    } catch {
      // Fall through to the display column.
    }
  }
  return slot.slotName ? [slot.slotName] : [];
}

/**
 * The first slot name in `uploaded` that is already taken, either by another
 * slot (`taken`) or earlier in the same file. Exact, case-sensitive match.
 * Pure; untested (drop-server has no test runner).
 */
export function findSlotNameClash(
  uploaded: string[],
  taken: Iterable<string>,
): string | undefined {
  const seen = new Set(taken);
  for (const name of uploaded) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
}

/**
 * What the daily reaper does with a session: close a Setup session with no
 * activity for SETUP_STALE_MS (SETUP_WITH_YAML_STALE_MS once anyone has
 * uploaded a YAML), delete a Closed one CLOSED_PURGE_MS after it closed, and
 * never touch a Running one (a multiworld can be played for weeks without Drop
 * seeing any of it). `lastActivity` is the latest of the session's
 * `lastActivityAt` (joins, rejoins, opens and polls by members, uploads,
 * connect address), its own update, and any slot join or upload. Pure;
 * untested (drop-server has no test runner).
 */
export function reapAction(
  session: {
    status: "Setup" | "Running" | "Closed";
    updatedAt: Date;
    lastActivity: Date;
    hasYaml: boolean;
  },
  now: Date,
): "close" | "purge" | null {
  const age = (d: Date) => now.getTime() - d.getTime();
  if (session.status === "Closed")
    return age(session.updatedAt) > CLOSED_PURGE_MS ? "purge" : null;
  if (session.status === "Setup") {
    const limit = session.hasYaml ? SETUP_WITH_YAML_STALE_MS : SETUP_STALE_MS;
    return age(session.lastActivity) > limit ? "close" : null;
  }
  return null;
}

class ArchipelagoManager {
  private addressCheck: {
    networkId: string;
    at: number;
    result: { address: string | null; verified: boolean };
  } | null = null;

  /** When the node was last found holding no address (see ADDRESS_CHECK_TTL_MS). */
  private addressMiss: { networkId: string; at: number } | null = null;

  private recordAddressMiss(networkId: string) {
    this.addressMiss = { networkId, at: Date.now() };
  }

  private missedRecently(networkId: string) {
    const miss = this.addressMiss;
    return (
      !!miss &&
      miss.networkId === networkId &&
      Date.now() - miss.at < ADDRESS_CHECK_TTL_MS
    );
  }

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
   * The IPv4 the controller node itself holds on the overlay, or undefined.
   * Only trusted when the node reports the network as OK: the controller's
   * member assignment is just its intent, and a node that joined without a TUN
   * device (status PORT_ERROR) can be "assigned" an address nobody can reach.
   */
  private async heldAddress(networkId: string): Promise<string | undefined> {
    const membership = await zerotierController.getJoinedNetwork(networkId);
    if (membership?.status !== "OK") return undefined;
    const v4 = (membership.assignedAddresses ?? []).find(isV4);
    return v4?.split("/")[0];
  }

  /** `heldAddress`, polled briefly since ZeroTier assigns it asynchronously. */
  private async resolveServerAddress(
    networkId: string,
  ): Promise<string | undefined> {
    for (let attempt = 0; attempt < IP_POLL_ATTEMPTS; attempt++) {
      const held = await this.heldAddress(networkId);
      if (held) return held;
      await sleep(IP_POLL_DELAY_MS);
    }
    return undefined;
  }

  /**
   * The server address to show, and whether the node really holds it right
   * now. Unverified means the stored value (possibly the controller's intent
   * from before this check existed) with no confirmation it is reachable.
   * Persists the held address when it differs from the stored one.
   */
  async checkServerAddress(
    networkId: string,
    stored: string | null,
  ): Promise<{ address: string | null; verified: boolean }> {
    const cached = this.addressCheck;
    if (
      cached &&
      cached.networkId === networkId &&
      Date.now() - cached.at < ADDRESS_CHECK_TTL_MS
    )
      return cached.result;

    let held: string | undefined;
    try {
      held = await this.heldAddress(networkId);
    } catch (e) {
      logger.warn(`[Archipelago] could not check the overlay address: ${e}`);
    }
    if (!held) this.recordAddressMiss(networkId);
    if (held && held !== stored) {
      await prisma.archipelagoNetwork.updateMany({
        where: { id: NETWORK_ROW_ID },
        data: { serverAddress: held },
      });
    }
    const result = held
      ? { address: held, verified: true }
      : { address: stored, verified: false };
    this.addressCheck = { networkId, at: Date.now(), result };
    return result;
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
      // Joined previously but the IP hadn't landed yet: try again, unless a
      // check in the last ADDRESS_CHECK_TTL_MS already found none. Each try
      // polls for ~3s and every create, join and reconnect comes through here;
      // on a node that can never hold one (no TUN device) that was every time.
      if (this.missedRecently(existing.networkId)) return existing;
      const serverAddress = await this.resolveServerAddress(existing.networkId);
      if (!serverAddress) {
        this.recordAddressMiss(existing.networkId);
        return existing;
      }
      // updateMany (not update) per the drop/no-prisma-delete rule. This is the
      // row we just findUnique'd, so merging the resolved address onto it is
      // exactly what update() would have returned.
      await prisma.archipelagoNetwork.updateMany({
        where: { id: NETWORK_ROW_ID },
        data: { serverAddress },
      });
      return { ...existing, serverAddress };
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
      if (!serverAddress) this.recordAddressMiss(networkId);
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
   * Authorize a player's device onto the shared overlay. The node id is also
   * stored on the slot so it can be de-authorized later.
   */
  private async authorizeMember(networkId: string, nodeId: string) {
    await zerotierController.setMemberAuthorized(networkId, nodeId, true);
  }

  /** Is `memberId` recorded on a slot of any open session? */
  private async inOpenSession(memberId: string): Promise<boolean> {
    const count = await prisma.archipelagoSlot.count({
      where: { memberId, session: { status: { not: "Closed" } } },
    });
    return count > 0;
  }

  /**
   * De-authorize `memberId` unless a slot of an open session records it,
   * checked right before the controller call and again right after. A join
   * writes its slot BEFORE authorizing, so a device that joins (or rejoins
   * another session) while this runs is either seen by the first check, or
   * authorizes after our de-authorize, or is seen by the second check and
   * authorized again here. Returns whether the member was left de-authorized.
   * Controller failures are thrown.
   */
  private async deauthorizeUnlessInOpenSession(
    networkId: string,
    memberId: string,
  ): Promise<boolean> {
    if (await this.inOpenSession(memberId)) return false;
    await zerotierController.setMemberAuthorized(networkId, memberId, false);
    if (await this.inOpenSession(memberId)) {
      await zerotierController.setMemberAuthorized(networkId, memberId, true);
      logger.info(
        `[Archipelago] ${memberId} joined a session while being de-authorized; authorized it again`,
      );
      return false;
    }
    return true;
  }

  /**
   * De-authorize each of `memberIds` that is no longer in any open session.
   * The overlay is shared by every session, so a device still in another open
   * session keeps its access (re-checked per device right before and after
   * the controller call, see deauthorizeUnlessInOpenSession). Never touches
   * the controller's own node.
   *
   * Best-effort: a controller failure is logged, not thrown, because the
   * leave or close that triggered it has already happened in the database and
   * the daily reaper's reconcileMembers pass retries it.
   */
  private async deauthorizeIfUnused(memberIds: (string | null)[]) {
    if (!this.isEnabled()) return;
    const ids = [...new Set(memberIds.filter((m): m is string => !!m))];
    if (ids.length === 0) return;

    const network = await prisma.archipelagoNetwork.findUnique({
      where: { id: NETWORK_ROW_ID },
    });
    if (!network) return;

    let controllerNodeId: string;
    try {
      controllerNodeId = await zerotierController.getControllerNodeId();
    } catch (e) {
      logger.warn(
        `[Archipelago] not de-authorizing anyone: couldn't read the controller's node id: ${e}`,
      );
      return;
    }

    for (const id of ids) {
      if (id === controllerNodeId) continue;
      try {
        if (await this.deauthorizeUnlessInOpenSession(network.networkId, id))
          logger.info(`[Archipelago] de-authorized ${id} from the overlay`);
      } catch (e) {
        logger.warn(
          `[Archipelago] failed to de-authorize ${id}; the daily reaper will retry: ${e}`,
        );
      }
    }
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
            slots: {
              create: {
                clientId: opts.hostClientId,
                memberId: opts.hostNodeId,
              },
            },
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
      statusMessage: "Could not start a session right now. Please try again.",
    });
  }

  /**
   * Join by short code. Re-joining a session you're already in (the client
   * does this to reconnect after a restart) re-authorizes the device,
   * refreshes its recorded node id and counts as activity.
   */
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
      throw createError({
        statusCode: 404,
        statusMessage: "session_not_found",
      });
    if (session.status === "Closed") throw sessionClosedError();

    const previous = await prisma.archipelagoSlot.findUnique({
      where: {
        sessionId_clientId: { sessionId: session.id, clientId: opts.clientId },
      },
      select: { memberId: true },
    });

    // Slot (and node id) first, then authorize: the reaper's reconcile pass
    // de-authorizes any node not recorded on an open session's slot.
    await prisma.archipelagoSlot.upsert({
      where: {
        sessionId_clientId: { sessionId: session.id, clientId: opts.clientId },
      },
      create: {
        sessionId: session.id,
        clientId: opts.clientId,
        memberId: opts.nodeId,
      },
      update: { memberId: opts.nodeId },
    });

    await this.authorizeMember(network.networkId, opts.nodeId);

    // Record the activity, and re-check the status now that the device is
    // authorized: a close that landed after the status read above may have
    // read the slots before this one existed and so not de-authorized it. If
    // the close is earlier than this write, undo our authorization; if later,
    // the close sees this slot and de-authorizes the device itself.
    const { count: stillOpen } = await prisma.archipelagoSession.updateMany({
      where: { id: session.id, status: { not: "Closed" } },
      data: { lastActivityAt: new Date() },
    });
    if (stillOpen === 0) {
      await this.deauthorizeIfUnused([opts.nodeId]);
      throw sessionClosedError();
    }

    // This device's ZeroTier identity changed (e.g. reinstalled): the old one
    // no longer belongs to anybody in this session.
    if (previous?.memberId && previous.memberId !== opts.nodeId)
      await this.deauthorizeIfUnused([previous.memberId]);

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
      throw createError({
        statusCode: 404,
        statusMessage: "session_not_found",
      });

    const isMember = session.slots.some(
      (s) => s.clientId === requestingClientId,
    );
    if (!isMember && session.hostClientId !== requestingClientId)
      throw createError({
        statusCode: 403,
        statusMessage: "You're not in this session.",
      });

    // A member opening or polling the session is activity, so the reaper
    // doesn't close a Setup session people still look at (e.g. one whose
    // connect address was shared outside Drop). At most one write an hour.
    if (
      session.status !== "Closed" &&
      Date.now() - session.lastActivityAt.getTime() > VIEW_ACTIVITY_INTERVAL_MS
    ) {
      try {
        await prisma.archipelagoSession.updateMany({
          where: { id: session.id, status: { not: "Closed" } },
          data: { lastActivityAt: new Date() },
        });
      } catch (e) {
        // Only the reaper's idle clock is affected, and the next poll retries;
        // not worth failing the view over.
        logger.warn(
          `[Archipelago] could not record activity on session ${session.id}: ${e}`,
        );
      }
    }

    const network = await prisma.archipelagoNetwork.findUnique({
      where: { id: NETWORK_ROW_ID },
    });

    const address = network
      ? await this.checkServerAddress(network.networkId, network.serverAddress)
      : { address: null, verified: false };

    const slots = session.slots.map((s) => ({
      clientId: s.clientId,
      clientName: s.client.name,
      slotName: s.slotName,
      game: s.game,
      hasYaml: !!s.yamlText,
      uploadedAt: s.uploadedAt,
      isHost: s.clientId === session.hostClientId,
      isSelf: s.clientId === requestingClientId,
    }));

    // Invalid YAMLs are rejected at upload and never stored, so a stored YAML
    // is a ready one.
    const ready = slots.filter((s) => s.hasYaml).length;

    return {
      sessionId: session.id,
      shortCode: session.shortCode,
      name: session.name,
      status: session.status,
      connectAddress: session.connectAddress,
      networkId: network?.networkId ?? null,
      serverAddress: address.address,
      // False when the controller node doesn't currently report holding that
      // address on the overlay, so players may not be able to reach it.
      serverAddressVerified: address.verified,
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
      include: { session: { select: { status: true } } },
    });
    if (!slot)
      throw createError({
        statusCode: 403,
        statusMessage: "You're not in this session.",
      });
    if (slot.session.status === "Closed") throw sessionClosedError();

    const summary = summariseYaml(opts.yamlText);

    const others = await prisma.archipelagoSlot.findMany({
      where: {
        sessionId: opts.sessionId,
        clientId: { not: opts.clientId },
        yamlText: { not: null },
      },
      select: { yamlText: true, slotName: true },
    });
    const clash = findSlotNameClash(
      summary.slotNames,
      others.flatMap(storedSlotNames),
    );
    if (clash)
      throw createError({
        statusCode: 409,
        statusMessage: `The slot name "${clash}" is used more than once in this session. Pick a different \`name\`.`,
      });

    // slotName / game are display-only (clash checks re-parse the YAML).
    const data = {
      yamlText: opts.yamlText,
      slotName: summary.slotNames.join(", "),
      game: summary.games.join(", "),
      uploadedAt: new Date(),
    };
    // updateMany (not update) per the drop/no-prisma-delete rule. The status
    // filter makes this refuse a session closed since the read above.
    const { count } = await prisma.archipelagoSlot.updateMany({
      where: {
        sessionId: opts.sessionId,
        clientId: opts.clientId,
        session: { status: { not: "Closed" } },
      },
      data,
    });
    if (count === 0) throw sessionClosedError();
    try {
      await prisma.archipelagoSession.updateMany({
        where: { id: opts.sessionId, status: { not: "Closed" } },
        data: { lastActivityAt: data.uploadedAt },
      });
    } catch (e) {
      // The YAML is stored, so don't report the upload as failed. The reaper
      // still counts the slot's uploadedAt as activity.
      logger.warn(
        `[Archipelago] could not record activity on session ${opts.sessionId}: ${e}`,
      );
    }
    return { ...slot, ...data };
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
      throw createError({
        statusCode: 404,
        statusMessage: "session_not_found",
      });

    // Every stored YAML passed validation at upload.
    const usable = session.slots.filter((s) => s.yamlText);
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
      throw createError({
        statusCode: 404,
        statusMessage: "session_not_found",
      });
    if (session.hostClientId !== opts.clientId)
      throw createError({
        statusCode: 403,
        statusMessage: "Only the host can set the connect address.",
      });
    if (session.status === "Closed") throw sessionClosedError();

    // Accept what the room page shows ("/connect 10.243.0.1:38286") as well as a
    // bare host:port, so the host can paste either.
    const cleaned = opts.connectAddress.trim().replace(/^\/connect\s+/i, "");
    if (!/^[^\s:]+:\d{1,5}$/.test(cleaned))
      throw createError({
        statusCode: 400,
        statusMessage: "That should look like `10.243.0.1:38281`.",
      });

    // updateMany (not update) per the drop/no-prisma-delete rule. The status
    // filter means a session closed since the read above stays Closed rather
    // than flipping back to Running.
    const { count } = await prisma.archipelagoSession.updateMany({
      where: { id: opts.sessionId, status: { not: "Closed" } },
      data: {
        connectAddress: cleaned,
        status: "Running",
        lastActivityAt: new Date(),
      },
    });
    if (count === 0) throw sessionClosedError();
    return { ...session, connectAddress: cleaned, status: "Running" as const };
  }

  /**
   * Leave a session. The host leaving closes it for everyone (mirrors co-op
   * rooms, where the host ending it dissolves the room). Either way, devices
   * no longer in any open session are de-authorized from the overlay.
   */
  async leaveSession(opts: { sessionId: string; clientId: string }) {
    const session = await prisma.archipelagoSession.findUnique({
      where: { id: opts.sessionId },
      include: { slots: { select: { clientId: true, memberId: true } } },
    });
    if (!session) return;

    if (session.hostClientId === opts.clientId) {
      await this.closeSession(opts.sessionId);
      return;
    }

    await prisma.archipelagoSlot.deleteMany({
      where: { sessionId: opts.sessionId, clientId: opts.clientId },
    });
    const mine = session.slots.find((s) => s.clientId === opts.clientId);
    await this.deauthorizeIfUnused([mine?.memberId ?? null]);
  }

  /**
   * Close a session and de-authorize members left in no open session. With
   * `onlyIfIdle` (the reaper), only closes it if it is still in Setup and no
   * activity was recorded since the reaper read it.
   */
  private async closeSession(
    sessionId: string,
    onlyIfIdle?: { lastActivityAt: Date },
  ) {
    const { count } = await prisma.archipelagoSession.updateMany({
      where: onlyIfIdle
        ? {
            id: sessionId,
            status: "Setup",
            lastActivityAt: { lte: onlyIfIdle.lastActivityAt },
          }
        : { id: sessionId, status: { not: "Closed" } },
      data: { status: "Closed" },
    });
    if (count === 0) return false;
    const slots = await prisma.archipelagoSlot.findMany({
      where: { sessionId },
      select: { memberId: true },
    });
    await this.deauthorizeIfUnused(slots.map((s) => s.memberId));
    return true;
  }

  /**
   * Make the controller's authorized members match the open sessions: any
   * authorized node that isn't the controller and isn't in an open session is
   * de-authorized. This catches de-authorizations that failed at leave/close
   * time. Skipped entirely while any open-session slot has no recorded node id
   * (joined before ids were recorded), since that device can't be told apart
   * from a stale one. Returns how many were de-authorized.
   */
  async reconcileMembers(): Promise<number> {
    if (!this.isEnabled()) return 0;
    const network = await prisma.archipelagoNetwork.findUnique({
      where: { id: NETWORK_ROW_ID },
    });
    if (!network) return 0;

    const open = await prisma.archipelagoSlot.findMany({
      where: { session: { status: { not: "Closed" } } },
      select: { memberId: true },
    });
    if (open.some((s) => !s.memberId)) {
      logger.info(
        "[Archipelago] skipping member reconcile: some open-session slots have no recorded node id yet",
      );
      return 0;
    }
    const keep = new Set(open.map((s) => s.memberId));
    keep.add(await zerotierController.getControllerNodeId());

    let removed = 0;
    for (const id of await zerotierController.listMemberIds(
      network.networkId,
    )) {
      if (keep.has(id)) continue;
      try {
        if (
          !(await zerotierController.isMemberAuthorized(network.networkId, id))
        )
          continue;
        // `keep` was read before this walk started, so a device may have
        // joined since: re-checked right before and after.
        if (await this.deauthorizeUnlessInOpenSession(network.networkId, id))
          removed++;
      } catch (e) {
        logger.warn(`[Archipelago] reconcile: failed on member ${id}: ${e}`);
      }
    }
    return removed;
  }

  /**
   * The daily reaper (see `reapAction` for the rules): close stale Setup
   * sessions, delete long-Closed ones, then reconcile overlay members.
   */
  async reapStale(now = new Date()) {
    const sessions = await prisma.archipelagoSession.findMany({
      where: { status: { in: ["Setup", "Closed"] } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        lastActivityAt: true,
        slots: { select: { joinedAt: true, uploadedAt: true } },
      },
    });

    let closed = 0;
    let purged = 0;
    for (const s of sessions) {
      const lastActivity = new Date(
        Math.max(
          s.updatedAt.getTime(),
          s.lastActivityAt.getTime(),
          ...s.slots.map((sl) =>
            Math.max(sl.joinedAt.getTime(), sl.uploadedAt?.getTime() ?? 0),
          ),
        ),
      );
      // uploadedAt is only ever set together with a stored YAML.
      const hasYaml = s.slots.some((sl) => sl.uploadedAt !== null);
      const action = reapAction({ ...s, lastActivity, hasYaml }, now);
      try {
        if (action === "close") {
          if (
            await this.closeSession(s.id, { lastActivityAt: s.lastActivityAt })
          )
            closed++;
        } else if (action === "purge") {
          const { count } = await prisma.archipelagoSession.deleteMany({
            where: { id: s.id, status: "Closed" },
          });
          purged += count;
        }
      } catch (e) {
        logger.warn(`[Archipelago] reaper: failed on session ${s.id}: ${e}`);
      }
    }

    let deauthorized = 0;
    try {
      deauthorized = await this.reconcileMembers();
    } catch (e) {
      logger.warn(`[Archipelago] reaper: member reconcile failed: ${e}`);
    }
    return { closed, purged, deauthorized };
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
