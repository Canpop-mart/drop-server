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
 * Combined download + upgrade task. Two phases:
 *   1. Ensure latest GBE release is cached in /data/gbe-cache (downloads if missing).
 *   2. Scan every game and upgrade SSE or Steam DRM installs to GBE in place.
 *
 * Single-game upgrade is still handled via
 * /api/v1/admin/game/[id]/upgrade-to-gbe for per-game overrides.
 *
 * Safe to re-run — already-upgraded games are skipped.
 */
export default defineDropTask({
  buildId: () => `upgrade:gbe:${new Date().toISOString()}`,
  name: "Upgrade to GBE",
  acls: ["system:maintenance:read"],
  taskGroup: "upgrade:gbe",

  async run({ progress, logger }) {
    logger.info("── Phase 1: Download + cache GBE DLLs ──");
    progress(2);

    const archs = ["win64", "win32", "linux"] as const;
    const needsDownload = !archs.some((a) => hasCachedDlls(a));

    if (needsDownload) {
      logger.info("No cached GBE DLLs found, downloading from GitHub...");
      const tag = await downloadGbeDlls();
      if (tag) {
        logger.info(`Downloaded GBE release: ${tag}`);
      } else {
        logger.info(
          "Automated download failed (releases may use .7z). Check /data/gbe-cache " +
            "for archives needing manual extraction, or download from " +
            "https://github.com/Detanup01/gbe_fork/releases.",
        );
      }
    } else {
      logger.info("GBE DLLs already cached — skipping download.");
    }

    for (const arch of archs) {
      logger.info(
        `  ${arch}: ${hasCachedDlls(arch) ? "✓ cached" : "✗ not found"}`,
      );
    }

    logger.info("── Phase 2: Scan + upgrade games ──");
    progress(10);

    const games = await prisma.game.findMany({
      select: { id: true, mName: true },
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
        progress(10 + Math.round((scanned / games.length) * 88));

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
