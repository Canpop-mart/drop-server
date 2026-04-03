import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resolveGameVersionDir } from "~/server/internal/goldberg";
import { detectEmulator, revertToSse } from "~/server/internal/gbe";

/**
 * POST /api/v1/admin/game/:id/revert-to-sse
 *
 * Reverts a GBE upgrade by restoring the SSE backup files.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, mName: true },
  });

  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  const versionDir = await resolveGameVersionDir(gameId);
  if (!versionDir)
    throw createError({
      statusCode: 400,
      statusMessage: "No filesystem version found.",
    });

  const detection = detectEmulator(versionDir);
  if (!detection)
    throw createError({
      statusCode: 400,
      statusMessage: "No Steam API DLL found.",
    });

  const result = revertToSse(detection.dllDir, detection.dllName);
  return result;
});
