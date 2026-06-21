import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * GET /api/v1/admin/room — list all co-op rooms (active + not-yet-reaped) with
 * their host and members, for the admin session-management page.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["room:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const rooms = await prisma.room.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      hostClient: { select: { id: true, name: true } },
      members: {
        include: { client: { select: { id: true, name: true } } },
      },
    },
  });

  return rooms.map((r) => ({
    id: r.id,
    shortCode: r.shortCode,
    networkId: r.networkId,
    gameId: r.gameId,
    name: r.name,
    hostClientId: r.hostClientId,
    hostClientName: r.hostClient?.name ?? null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    members: r.members.map((m) => ({
      clientId: m.clientId,
      clientName: m.client?.name ?? m.clientId,
      status: m.status,
      isHost: m.clientId === r.hostClientId,
      joinedAt: m.joinedAt,
    })),
  }));
});
