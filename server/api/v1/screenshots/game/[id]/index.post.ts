// create new screenshot
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import screenshotManager from "~/server/internal/screenshots";
import { logger } from "~/server/internal/logging";
import { enforceUploadLimit } from "~/server/internal/objects/uploadLimits";

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

  // Reject uploads that declare an oversized Content-Length up front.
  // The stream that gets piped to the object backend has no built-in
  // cap, so this is our only guard — anything that lies about its
  // size will still consume disk until the stream completes. A
  // streaming counter inside ScreenshotManager.upload would be the
  // belt-and-braces fix; deferred to a follow-up.
  const maxBytes = enforceUploadLimit(h3, "screenshot");

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true },
  });
  if (!game)
    throw createError({ statusCode: 400, statusMessage: "Invalid game ID" });

  try {
    await screenshotManager.upload(userId, gameId, h3.node.req, maxBytes);
  } catch (err) {
    logger.error(`[SCREENSHOT] Upload failed for game ${gameId}:`, err);
    if (err instanceof Error && err.message === "ScreenshotTooLarge") {
      throw createError({
        statusCode: 413,
        statusMessage: "Screenshot exceeds size limit",
      });
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Screenshot upload failed",
    });
  }

  return { success: true };
});
