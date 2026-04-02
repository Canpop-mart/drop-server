import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * List cloud save slots for a specific game for the authenticated user.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "No gameId in route params",
    });

  const saves = await prisma.saveSlot.findMany({
    where: { userId: user.id, gameId },
    orderBy: { index: "asc" },
  });

  return saves;
});
