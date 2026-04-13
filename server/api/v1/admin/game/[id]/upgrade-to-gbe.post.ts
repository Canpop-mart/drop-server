import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resolveGameVersionDir } from "~/server/internal/goldberg";
import {
  detectEmulator,
  downloadGbeDlls,
  hasCachedDlls,
  upgradeSseToGbe,
} from "~/server/internal/gbe";
import { logger } from "~/server/internal/logging";

/**
 * POST /api/v1/admin/game/:id/upgrade-to-gbe
 *
 * Upgrades a single game from SmartSteamEmu to GBE (Goldberg fork).
 * Creates backups of original SSE files before replacing.
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
      statusMessage: "No filesystem version found for this game.",
    });

  const detection = detectEmulator(versionDir);
  if (!detection)
    throw createError({
      statusCode: 400,
      statusMessage: "No Steam API DLL found in game directory.",
    });

  if (detection.type !== "sse")
    throw createError({
      statusCode: 400,
      statusMessage: `Game uses ${detection.type}, not SmartSteamEmu. No upgrade needed.`,
    });

  // Ensure GBE DLLs are available
  if (!hasCachedDlls("win64") && !hasCachedDlls("win32")) {
    logger.info("[GBE] No cached DLLs, downloading...");
    await downloadGbeDlls();
  }

  // Simple logger that collects messages
  const logs: string[] = [];
  const localLogger = {
    info: (msg: string) => {
      logger.info(`[GBE] ${msg}`);
      logs.push(msg);
    },
  };

  const result = await upgradeSseToGbe(
    versionDir,
    gameId,
    detection,
    localLogger,
  );

  return {
    success: result.success,
    message: result.message,
    backupCreated: result.backupCreated,
    logs,
  };
});
