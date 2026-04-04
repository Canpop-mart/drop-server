import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Returns the save path configuration for a game.
 * Used by the desktop client to know which local files to back up.
 */
export default defineClientEventHandler(async (h3) => {
  const gameId = getRouterParam(h3, "gameid");
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "No gameID in route params",
    });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { savePaths: true },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  return game.savePaths ?? null;
});
