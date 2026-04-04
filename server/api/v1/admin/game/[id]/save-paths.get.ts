import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID" });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { savePaths: true },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  return game.savePaths ?? null;
});
