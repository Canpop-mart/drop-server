import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import roomManager from "~/server/internal/zerotier";

/**
 * DELETE /api/v1/admin/room/:id — tear a room down immediately (deletes the
 * ZeroTier network on the controller + the DB record).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["room:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");
  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, networkId: true },
  });
  if (!room)
    throw createError({ statusCode: 404, statusMessage: "Room not found" });

  await roomManager.destroyRoom(room.id, room.networkId);
  return;
});
