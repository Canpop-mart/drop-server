import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Delete a specific cloud save slot (web UI).
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const slotIndexStr = getRouterParam(h3, "slotIndex");
  if (!slotIndexStr)
    throw createError({ statusCode: 400, statusMessage: "No slot index." });

  const slotIndex = parseInt(slotIndexStr);
  if (Number.isNaN(slotIndex))
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid slot index.",
    });

  const { count } = await prisma.saveSlot.deleteMany({
    where: {
      userId: user.id,
      gameId,
      index: slotIndex,
    },
  });

  if (count === 0)
    throw createError({ statusCode: 404, statusMessage: "Save not found." });

  return { deleted: true };
});
