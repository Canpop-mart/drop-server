import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resolveGameVersionDir } from "~/server/internal/goldberg";
import {
  detectEmulator,
  downloadGbeDlls,
  hasCachedDlls,
  hasSteamDrmMarker,
  upgradeSseToGbe,
  upgradeSteamDrmToGbe,
} from "~/server/internal/gbe";
import { logger } from "~/server/internal/logging";
import { getQuery } from "h3";

/**
 * POST /api/v1/admin/game/:id/upgrade-to-gbe
 *
 * Upgrades a single game to GBE (Goldberg fork). Handles two cases:
 *   - SmartSteamEmu games: detected via steam_emu.ini next to the DLL
 *   - Real Steam DRM games: detected via steamclient64.dll /
 *     gameoverlayrenderer64.dll, with AppID from Steam metadata
 *
 * For both cases the server writes steam_settings/ next to the Steam API
 * DLL; the client handles the DLL swap at launch so existing manifest
 * checksums remain valid.
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

  // Ensure GBE DLLs are available (needed by both paths)
  if (!hasCachedDlls("win64") && !hasCachedDlls("win32")) {
    logger.info("[GBE] No cached DLLs, downloading...");
    await downloadGbeDlls();
  }

  const logs: string[] = [];
  const localLogger = {
    info: (msg: string) => {
      logger.info(`[GBE] ${msg}`);
      logs.push(msg);
    },
    warn: (msg: string) => {
      logger.warn(`[GBE] ${msg}`);
      logs.push(`[warn] ${msg}`);
    },
  };

  const detection = detectEmulator(versionDir);

  // ── SSE path ─────────────────────────────────────────────────────────────
  if (detection?.type === "sse") {
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
  }

  // ── Steam DRM path ───────────────────────────────────────────────────────
  if (hasSteamDrmMarker(versionDir)) {
    const meta = await prisma.game.findUnique({
      where: { id: gameId },
      select: { metadataSource: true, metadataId: true },
    });
    const steamAppId =
      meta?.metadataSource === "Steam" ? meta.metadataId : null;
    if (!steamAppId) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Steam DRM detected but no Steam AppID in game metadata. Cannot upgrade.",
      });
    }

    // Admin escape hatch: pass ?force=1 to bypass the positive-Valve
    // fingerprint check (e.g. for a custom Goldberg fork that doesn't
    // carry the standard signatures, or for a DLL we deliberately want
    // to clobber). Without it, ensureGbeDll refuses to overwrite known
    // cracks or unidentifiable DLLs.
    const query = getQuery(h3);
    const forceGbeSwap =
      query.force === "1" || query.force === "true" || query.force === true;

    const result = await upgradeSteamDrmToGbe(
      versionDir,
      gameId,
      steamAppId,
      localLogger,
      { forceGbeSwap },
    );
    return {
      success: result.success,
      message: result.message,
      backupCreated: result.backupCreated,
      logs,
    };
  }

  // ── Nothing to upgrade ───────────────────────────────────────────────────
  if (!detection) {
    throw createError({
      statusCode: 400,
      statusMessage: "No Steam API DLL found in game directory.",
    });
  }

  throw createError({
    statusCode: 400,
    statusMessage: `Game uses ${detection.type} and no Steam DRM markers were found. No upgrade needed.`,
  });
});
