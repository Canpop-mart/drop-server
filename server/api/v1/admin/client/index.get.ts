import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * GET /api/v1/admin/client — list every paired client device (across all users)
 * for the admin device-management page.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["client:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const clients = await prisma.client.findMany({
    orderBy: { lastConnected: "desc" },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
      _count: { select: { hostedRooms: true, roomMemberships: true } },
    },
  });

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    lastConnected: c.lastConnected,
    userId: c.userId,
    userName: c.user?.displayName ?? c.user?.username ?? c.userId,
    hostedRoomCount: c._count.hostedRooms,
    memberRoomCount: c._count.roomMemberships,
  }));
});
