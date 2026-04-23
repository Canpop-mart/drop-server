import { defineDropTask } from "..";
import prisma from "../../db/database";
import { resolveGameVersionDir } from "../../goldberg";
import {
  detectEmulator,
  downloadGbeDlls,
  hasCachedDlls,
  hasSteamDrmMarker,
  upgradeSseToGbe,
  upgradeSteamDrmToGbe,
} from "../../gbe";

/**
 * Batch task: scans all games and upgrades them to GBE (Goldberg fork)
 * for proper achievement support. Covers two cases:
 *
 *   1. SmartSteamEmu games (identified by steam_emu.ini next to the DLL)
 *   2. Real Steam DRM games (identified by steamclient64.dll /
 *      gameoverlayrenderer64.dll anywhere under the version directory,
 *      plus a Steam AppID from the game's metadata)
 *
 * For each matching game the server writes steam_settings/ adjacent to
 * the Steam API DLL. The DLL swap itself is performed client-side at
 * launch time so existing manifest checksums stay valid.
 *
 * Safe to run multiple times — already-configured games are skipped.
 */
export const upgradeAllToGbe = defineDropTask({
  buildId: () => `upgrade:all-to-gbe:${new Date().toISOString()}`,
  name: "Upgrade All Games to GBE (SSE + Steam DRM)",
  acls: ["system:maintenance:read"],
  taskGroup: "upgrade:all-to-gbe",

  async run({ progress, logger }) {
    logger.info("Starting batch upgrade to GBE (SSE + Steam DRM)");

    // ── Step 1: Ensure GBE DLLs are cached ────────────────────────────────
    progress(5);
    const hasWin64 = hasCachedDlls("win64");
    const hasWin32 = hasCachedDlls("win32");

    if (!hasWin64 && !hasWin32) {
      logger.info("No cached GBE DLLs found, downloading from GitHub...");
      const tag = await downloadGbeDlls();
      if (tag) {
        logger.info(`Downloaded GBE release: ${tag}`);
      } else {
        logger.info(
          "Failed to download GBE DLLs automatically. " +
            "GBE uses .7z archives — you may need to download from " +
            "https://github.com/Detanup01/gbe_fork/releases and place " +
            "the DLLs in the cache directory manually.",
        );
      }
    } else {
      logger.info("GBE DLLs already cached");
    }

    // ── Step 2: Scan all games ────────────────────────────────────────────
    progress(10);
    const games = await prisma.game.findMany({
      select: {
        id: true,
        mName: true,
      },
    });

    if (games.length === 0) {
      logger.info("No games found");
      progress(100);
      return;
    }

    logger.info(`Scanning ${games.length} game(s) for SSE and Steam DRM`);

    const fs = await import("fs");

    let scanned = 0;
    let sseFound = 0;
    let sseUpgraded = 0;
    let sseSkipped = 0;
    let sseFailed = 0;
    let drmFound = 0;
    let drmUpgraded = 0;
    let drmSkipped = 0;
    let drmNoAppId = 0;
    let drmFailed = 0;

    for (const game of games) {
      scanned++;
      const reportProgress = () =>
        progress(10 + Math.round((scanned / games.length) * 85));

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        reportProgress();
        continue;
      }

      const detection = detectEmulator(versionDir);

      if (detection?.type === "goldberg") {
        logger.info(`${game.mName} — already using Goldberg, skipping`);
        reportProgress();
        continue;
      }

      // ── SSE path ────────────────────────────────────────────────────────
      if (detection?.type === "sse") {
        sseFound++;
        logger.info(
          `${game.mName} — SSE detected (AppID: ${detection.sseConfig?.appId ?? "unknown"})`,
        );

        const { dllDir, dllName } = detection;
        const backupPath = `${dllDir}/${dllName}.sse_backup`;
        if (fs.existsSync(backupPath)) {
          logger.info(
            `${game.mName} — SSE backup already exists, skipping (already upgraded?)`,
          );
          sseSkipped++;
          reportProgress();
          continue;
        }

        const result = await upgradeSseToGbe(
          versionDir,
          game.id,
          detection,
          logger,
        );
        if (result.success) {
          logger.info(`${game.mName} — ${result.message}`);
          sseUpgraded++;
        } else {
          logger.info(`${game.mName} — FAILED: ${result.message}`);
          sseFailed++;
        }

        reportProgress();
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // ── Steam DRM path ──────────────────────────────────────────────────
      // Triggered when steamclient64.dll / gameoverlayrenderer64.dll is
      // present alongside a bundled steam_api64.dll (legitimate Steam DRM,
      // not SSE). AppID comes from the game's Steam metadata.
      if (hasSteamDrmMarker(versionDir)) {
        drmFound++;

        const meta = await prisma.game.findUnique({
          where: { id: game.id },
          select: { metadataSource: true, metadataId: true },
        });
        const steamAppId =
          meta?.metadataSource === "Steam" ? meta.metadataId : null;

        if (!steamAppId) {
          logger.info(
            `${game.mName} — Steam DRM detected but no Steam AppID in metadata, skipping`,
          );
          drmNoAppId++;
          reportProgress();
          continue;
        }

        logger.info(
          `${game.mName} — Steam DRM detected (AppID: ${steamAppId})`,
        );

        const result = await upgradeSteamDrmToGbe(
          versionDir,
          game.id,
          steamAppId,
          logger,
        );
        if (result.success) {
          if (result.message.includes("already")) {
            drmSkipped++;
          } else {
            drmUpgraded++;
          }
          logger.info(`${game.mName} — ${result.message}`);
        } else {
          logger.info(`${game.mName} — FAILED: ${result.message}`);
          drmFailed++;
        }

        reportProgress();
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // No emulator, no Steam DRM — skip silently
      reportProgress();
    }

    logger.info(
      `Done — scanned ${scanned}. ` +
        `SSE: found ${sseFound}, upgraded ${sseUpgraded}, already done ${sseSkipped}, failed ${sseFailed}. ` +
        `Steam DRM: found ${drmFound}, upgraded ${drmUpgraded}, already done ${drmSkipped}, skipped (no AppID) ${drmNoAppId}, failed ${drmFailed}.`,
    );
    progress(100);
  },
});

// Single-game upgrade is handled via a direct API endpoint at
// /api/v1/admin/game/[id]/upgrade-to-gbe — see that route for details.

/**
 * Downloads GBE DLLs from GitHub without upgrading any games.
 * Useful when the automated extraction fails and you need to
 * download the archives for manual extraction.
 */
export const downloadGbe = defineDropTask({
  buildId: () => `download:gbe:${new Date().toISOString()}`,
  name: "Download GBE DLLs",
  acls: ["system:maintenance:read"],
  taskGroup: "download:gbe",

  async run({ progress, logger }) {
    logger.info("Downloading latest GBE release from GitHub...");
    progress(10);

    const tag = await downloadGbeDlls();

    if (tag) {
      logger.info(`Downloaded GBE release: ${tag}`);

      // Report what we have cached
      const archs = ["win64", "win32", "linux"] as const;
      for (const arch of archs) {
        logger.info(
          `  ${arch}: ${hasCachedDlls(arch) ? "✓ cached" : "✗ not found"}`,
        );
      }
    } else {
      logger.info(
        "Could not download GBE DLLs automatically. " +
          "The release may use .7z archives. Check the cache directory for " +
          "downloaded archives that need manual extraction.",
      );
    }

    progress(100);
  },
});
