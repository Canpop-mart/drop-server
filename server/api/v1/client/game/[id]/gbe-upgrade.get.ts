import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { resolveGameVersionDir } from "~/server/internal/goldberg";
import {
  detectEmulator,
  getCachedDllPath,
  type GbeArch,
} from "~/server/internal/gbe";
import fs from "fs";
import path from "path";

const DLL_TO_ARCH: Record<string, GbeArch> = {
  "steam_api64.dll": "win64",
  "steam_api.dll": "win32",
  "libsteam_api.so": "linux",
};

/**
 * GET /api/v1/client/game/:id/gbe-upgrade
 *
 * Returns the GBE DLL for this game if:
 *   1. The game has been SSE→GBE upgraded (steam_settings/ exists alongside steam_emu.ini)
 *   2. A cached GBE DLL is available for the right architecture
 *
 * The client calls this at launch when it detects an SSE game that has
 * a `steam_settings/` directory (created by the server-side upgrade).
 *
 * Response: binary DLL stream with headers indicating the DLL filename,
 * or 404 if no upgrade is available.
 */
export default defineClientEventHandler(async (h3) => {
  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const versionDir = await resolveGameVersionDir(gameId);
  if (!versionDir)
    throw createError({
      statusCode: 404,
      statusMessage: "No version directory.",
    });

  const detection = detectEmulator(versionDir);
  if (!detection)
    throw createError({
      statusCode: 404,
      statusMessage: "No Steam API DLL found.",
    });

  // Only serve GBE DLL if the game has been upgraded (steam_settings/ exists
  // alongside the SSE config, meaning admin ran the upgrade task).
  const steamSettings = path.join(detection.dllDir, "steam_settings");
  if (!fs.existsSync(steamSettings)) {
    throw createError({
      statusCode: 404,
      statusMessage: "Game has not been upgraded to GBE.",
    });
  }

  const arch = DLL_TO_ARCH[detection.dllName.toLowerCase()];
  if (!arch) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown DLL architecture: ${detection.dllName}`,
    });
  }

  const gbeDllPath = getCachedDllPath(arch);
  if (!gbeDllPath) {
    throw createError({
      statusCode: 404,
      statusMessage: `No cached GBE DLL for ${arch}. Run "Download GBE" task.`,
    });
  }

  // Stream the DLL to the client
  setResponseHeader(h3, "Content-Type", "application/octet-stream");
  setResponseHeader(
    h3,
    "Content-Disposition",
    `attachment; filename="${detection.dllName}"`,
  );
  setResponseHeader(h3, "X-GBE-Dll-Name", detection.dllName);

  const stat = fs.statSync(gbeDllPath);
  setResponseHeader(h3, "Content-Length", stat.size.toString());

  return sendStream(h3, fs.createReadStream(gbeDllPath));
});
