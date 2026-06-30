/*
Manages co-op "rooms": ephemeral self-hosted ZeroTier virtual-LAN networks that
let friends play LAN/direct-IP games across the internet. The host mints a room
(a network) and shares a short code; joiners are auto-authorized onto it by the
controller, then their game's own LAN discovery takes over.

Follows the manager-singleton pattern (cf. userlibrary). The controller HTTP
calls live in ./controller; this layer owns the DB + business rules.
*/

import { randomBytes } from "node:crypto";
import prisma from "../db/database";
import { systemConfig } from "../config/sys-conf";
import { zerotierController } from "./controller";
import { logger } from "../logging";

// Rooms are throwaway co-op sessions; reap them a day after creation.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

// Ambiguity-free alphabet (no 0/O/1/I/L) so codes are easy to read out loud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

// Each room gets its own /24 inside this /16 so ZeroTier never assigns two rooms
// the same node the same address (the third octet is allocated uniquely per
// room). An uncommon parent to minimise clashes with players' real home LANs.
const ROOM_SUBNET_BASE = "10.242"; // -> 10.242.<octet>.0/24

// ZeroTier node ids are 40-bit → 10 lowercase hex chars.
export const ZT_NODE_ID_RE = /^[0-9a-f]{10}$/;

/** Prisma unique-constraint violation — used to retry a raced allocation. */
function isUniqueConstraintError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

class RoomManager {
  isEnabled() {
    return systemConfig.isZerotierEnabled();
  }

  private ensureEnabled() {
    if (!this.isEnabled())
      throw createError({
        statusCode: 503,
        statusMessage: "Co-op rooms are not enabled on this server.",
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
      const existing = await prisma.room.findUnique({
        where: { shortCode: code },
      });
      if (!existing) return code;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Could not allocate a unique room code.",
    });
  }

  /**
   * Pick a free third octet for this room's /24 (10.242.<octet>.0/24). Octets
   * 1..254 (0 = the legacy shared subnet, 255 = broadcast). The column is
   * @unique, so a race is caught as a P2002 on insert and createRoom re-rolls.
   */
  private async allocateSubnetOctet(): Promise<number> {
    const live = await prisma.room.findMany({
      where: { subnetOctet: { not: null } },
      select: { subnetOctet: true },
    });
    const used = new Set(live.map((r) => r.subnetOctet));
    const free: number[] = [];
    for (let o = 1; o <= 254; o++) if (!used.has(o)) free.push(o);
    if (free.length === 0)
      throw createError({
        statusCode: 503,
        statusMessage: "Too many active co-op rooms — try again later.",
      });
    return free[Math.floor(Math.random() * free.length)];
  }

  /**
   * Host a new room: allocate a unique /24, mint the network, authorize the
   * host, and persist. Retries on a unique-constraint race (two hosts grabbing
   * the same code or subnet octet); rolls back a minted network if the persist
   * loses the race so the controller isn't left with an orphan.
   */
  async createRoom(opts: {
    hostClientId: string;
    hostNodeId: string;
    gameId?: string;
    name?: string;
  }) {
    this.ensureEnabled();
    // Opportunistically clean up expired rooms so they don't pile up.
    await this.reapExpired();

    for (let attempt = 0; attempt < 8; attempt++) {
      const shortCode = await this.allocateUniqueCode();
      const octet = await this.allocateSubnetOctet();
      const base = `${ROOM_SUBNET_BASE}.${octet}`;
      let networkId: string | undefined;
      try {
        networkId = await zerotierController.createNetwork({
          name: `drop-${shortCode}`,
          private: true,
          enableBroadcast: true,
          v4AssignMode: { zt: true },
          ipAssignmentPools: [
            { ipRangeStart: `${base}.1`, ipRangeEnd: `${base}.254` },
          ],
          routes: [{ target: `${base}.0/24`, via: null }],
        });

        // Authorize the host before we persist, so a controller failure doesn't
        // leave a DB room pointing at a network nobody can use.
        await zerotierController.setMemberAuthorized(
          networkId,
          opts.hostNodeId,
          true,
        );

        const room = await prisma.room.create({
          data: {
            networkId,
            shortCode,
            subnetOctet: octet,
            gameId: opts.gameId,
            name: opts.name,
            hostClientId: opts.hostClientId,
            expiresAt: new Date(Date.now() + ROOM_TTL_MS),
            members: {
              create: {
                clientId: opts.hostClientId,
                memberId: opts.hostNodeId,
                status: "Authorized",
              },
            },
          },
        });

        return {
          roomId: room.id,
          shortCode: room.shortCode,
          networkId: room.networkId,
          gameId: room.gameId,
          name: room.name,
        };
      } catch (e) {
        // A losing race leaves a minted network with no DB row — delete it.
        if (networkId)
          await zerotierController.deleteNetwork(networkId).catch(() => {});
        if (isUniqueConstraintError(e)) continue;
        throw e;
      }
    }

    throw createError({
      statusCode: 503,
      statusMessage: "Could not allocate a co-op room right now — please try again.",
    });
  }

  /**
   * Join a room by its short code: authorize the joiner's node and record them.
   */
  async joinRoom(opts: {
    shortCode: string;
    clientId: string;
    nodeId: string;
  }) {
    this.ensureEnabled();

    const room = await prisma.room.findUnique({
      where: { shortCode: opts.shortCode.toUpperCase() },
    });
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found." });
    if (room.expiresAt && room.expiresAt.getTime() < Date.now())
      throw createError({
        statusCode: 410,
        statusMessage: "Room has expired.",
      });

    await zerotierController.setMemberAuthorized(
      room.networkId,
      opts.nodeId,
      true,
    );

    await prisma.roomMember.upsert({
      where: {
        roomId_clientId: { roomId: room.id, clientId: opts.clientId },
      },
      create: {
        roomId: room.id,
        clientId: opts.clientId,
        memberId: opts.nodeId,
        status: "Authorized",
      },
      update: { memberId: opts.nodeId, status: "Authorized" },
    });

    return {
      roomId: room.id,
      networkId: room.networkId,
      hostAddress: room.hostAddress,
      gameId: room.gameId,
      name: room.name,
    };
  }

  /**
   * The host self-reports its assigned ZeroTier IP for this room (ZeroTier
   * assigns it asynchronously after join, so it isn't known at create time).
   * Joiners read it back from getRoom to connect by IP.
   */
  async setHostAddress(opts: {
    roomId: string;
    clientId: string;
    address: string;
  }) {
    const room = await prisma.room.findUnique({ where: { id: opts.roomId } });
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found." });
    if (room.hostClientId !== opts.clientId)
      throw createError({
        statusCode: 403,
        statusMessage: "Only the host can set the room address.",
      });
    await prisma.room.update({
      where: { id: opts.roomId },
      data: { hostAddress: opts.address },
    });
    return { ok: true };
  }

  /**
   * List currently-joinable rooms so a client can join without a shared code.
   * Returns every live (non-expired) room with enough detail to pick one; the
   * short code is included because joining is by code. On a private Drop server
   * that's the intended "open lobby" behaviour.
   */
  async browseRooms(requestingClientId: string) {
    this.ensureEnabled();
    await this.reapExpired();

    const rooms = await prisma.room.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: {
        hostClient: { select: { name: true } },
        members: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const gameIds = [
      ...new Set(rooms.map((r) => r.gameId).filter((g): g is string => !!g)),
    ];
    const games = gameIds.length
      ? await prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: { id: true, mName: true },
        })
      : [];
    const gameMap = Object.fromEntries(games.map((g) => [g.id, g.mName]));

    return rooms.map((r) => ({
      roomId: r.id,
      shortCode: r.shortCode,
      name: r.name,
      gameId: r.gameId,
      gameName: r.gameId ? (gameMap[r.gameId] ?? null) : null,
      hostName: r.hostClient?.name ?? "Unknown",
      memberCount: r.members.filter((m) => m.status === "Authorized").length,
      createdAt: r.createdAt,
      isSelf: r.hostClientId === requestingClientId,
    }));
  }

  /**
   * Fetch a room's state. The caller must be the host or a member.
   */
  async getRoom(roomId: string, requestingClientId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: {
          include: { client: { select: { id: true, name: true } } },
        },
      },
    });
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found." });

    const isMember =
      room.hostClientId === requestingClientId ||
      room.members.some((m) => m.clientId === requestingClientId);
    if (!isMember)
      throw createError({ statusCode: 403, statusMessage: "Forbidden." });

    let controllerNodeId: string | null = null;
    try {
      controllerNodeId = await zerotierController.getControllerNodeId();
    } catch {
      // best-effort: the client only needs this to scope its network sweep
    }

    // Resolve every authorized member's controller-assigned overlay IP once. The
    // controller is the source of truth — it assigns IPs from the room's pool as
    // each node comes online. We use this for BOTH the host's connect address and
    // the requester's peer list, because it's far more reliable than the host's
    // self-report poll (which gives up if ZeroTier is slow to assign on a fresh
    // network join). A member whose IP isn't assigned yet is simply omitted and
    // fills in on a later poll. Best-effort — never fail getRoom over this.
    const memberIp = new Map<string, string>();
    for (const m of room.members) {
      if (m.status !== "Authorized") continue;
      try {
        const ips = await zerotierController.getMemberIpAssignments(
          room.networkId,
          m.memberId,
        );
        const ip = ips[0]?.split("/")[0];
        if (ip) memberIp.set(m.clientId, ip);
      } catch {
        // member IP not yet assigned / controller hiccup — omit this member
      }
    }
    // Host connect address: prefer the controller's assignment, fall back to the
    // host's self-report (report_host_address) when the controller doesn't have
    // it yet. This is what populates the "Connect address" box for join-by-IP.
    const hostAddress = memberIp.get(room.hostClientId) ?? room.hostAddress;
    // The OTHER peers' IPs, for the requester's Goldberg custom_broadcasts.txt
    // (broadcast is dropped on the ZeroTier L3 overlay, so peers must unicast).
    const peerAddresses = [...memberIp.entries()]
      .filter(([clientId]) => clientId !== requestingClientId)
      .map(([, ip]) => ip);

    return {
      roomId: room.id,
      shortCode: room.shortCode,
      networkId: room.networkId,
      hostAddress,
      controllerNodeId,
      peerAddresses,
      gameId: room.gameId,
      name: room.name,
      hostClientId: room.hostClientId,
      expiresAt: room.expiresAt,
      members: room.members.map((m) => ({
        clientId: m.clientId,
        clientName: m.client.name,
        status: m.status,
        joinedAt: m.joinedAt,
        isHost: m.clientId === room.hostClientId,
      })),
    };
  }

  /**
   * Leave a room. If the host leaves, the whole room (and its network) is torn
   * down; otherwise the member is de-authorized and marked as left.
   */
  async leaveRoom(opts: { roomId: string; clientId: string }) {
    const room = await prisma.room.findUnique({
      where: { id: opts.roomId },
      include: { members: { where: { clientId: opts.clientId } } },
    });
    if (!room)
      throw createError({ statusCode: 404, statusMessage: "Room not found." });

    if (room.hostClientId === opts.clientId) {
      await this.destroyRoom(room.id, room.networkId);
      return { destroyed: true };
    }

    const membership = room.members[0];
    if (membership) {
      // Best-effort de-authorization; we still mark them left regardless.
      try {
        await zerotierController.setMemberAuthorized(
          room.networkId,
          membership.memberId,
          false,
        );
      } catch (e) {
        logger.warn(`[ZeroTier] Failed to de-authorize member on leave: ${e}`);
      }
      await prisma.roomMember.updateMany({
        where: { roomId: room.id, clientId: opts.clientId },
        data: { status: "Left" },
      });
    }
    return { destroyed: false };
  }

  /** Delete a room's network on the controller, then the DB record (cascades). */
  async destroyRoom(roomId: string, networkId: string) {
    try {
      await zerotierController.deleteNetwork(networkId);
    } catch (e) {
      // Don't orphan the DB row over a controller hiccup — log and continue.
      logger.warn(`[ZeroTier] Failed to delete network ${networkId}: ${e}`);
    }
    await prisma.room.deleteMany({ where: { id: roomId } });
  }

  /** Tear down rooms whose TTL has elapsed. Best-effort; never throws. */
  async reapExpired() {
    const expired = await prisma.room.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true, networkId: true },
    });
    for (const room of expired) {
      try {
        await this.destroyRoom(room.id, room.networkId);
      } catch (e) {
        logger.warn(`[ZeroTier] Failed to reap room ${room.id}: ${e}`);
      }
    }
  }
}

export const roomManager = new RoomManager();
export default roomManager;
