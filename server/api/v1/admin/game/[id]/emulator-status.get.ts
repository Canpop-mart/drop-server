import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resolveGameVersionDir } from "~/server/internal/goldberg";
import { detectEmulator, type EmulatorType } from "~/server/internal/gbe";
import fs from "fs";

/**
 * GET /api/v1/admin/game/:id/emulator-status
 *
 * Returns which Steam emulator a game uses and whether it can be upgraded.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
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
  if (!versionDir) {
    return {
      emulatorType: "none" as EmulatorType | "none",
      canUpgrade: false,
      details: "No filesystem version found",
    };
  }

  const detection = detectEmulator(versionDir);
  if (!detection) {
    return {
      emulatorType: "none" as EmulatorType | "none",
      canUpgrade: false,
      details: "No Steam API DLL found",
    };
  }

  const hasBackup = fs.existsSync(
    `${detection.dllDir}/${detection.dllName}.sse_backup`,
  );

  return {
    emulatorType: detection.type,
    dllDir: detection.dllDir,
    dllName: detection.dllName,
    canUpgrade: detection.type === "sse" && !hasBackup,
    alreadyUpgraded: hasBackup,
    sseConfig: detection.sseConfig
      ? {
          appId: detection.sseConfig.appId,
          dlcCount: detection.sseConfig.dlcs.size,
          interfaceCount: detection.sseConfig.interfaces.size,
        }
      : undefined,
  };
});
