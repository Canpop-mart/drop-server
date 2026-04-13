// create new screenshot
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import screenshotManager from "~/server/internal/screenshots";
import { logger } from "~/server/internal/logging";

// TODO: make defineClientEventHandler instead?
// only clients will be upload screenshots yea??
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["screenshots:new"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing game ID",
    });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true },
  });
  if (!game)
    throw createError({ statusCode: 400, statusMessage: "Invalid game ID" });

  try {
    await screenshotManager.upload(userId, gameId, h3.node.req);
  } catch (err) {
    logger.error(`[SCREENSHOT] Upload failed for game ${gameId}:`, err);
    throw createError({
      statusCode: 500,
      statusMessage: "Screenshot upload failed",
    });
  }

  return { success: true };
});
