import { defineDropTask } from "..";
import prisma from "../../db/database";
import { resolveGameVersionDir } from "../../goldberg";
import {
  detectEmulator,
  downloadGbeDlls,
  hasCachedDlls,
  upgradeSseToGbe,
} from "../../gbe";

/**
 * Batch task: scans all games for SmartSteamEmu installations and replaces
 * them with GBE (Goldberg fork) for proper achievement support.
 *
 * Steps:
 * 1. Ensures GBE DLLs are downloaded and cached
 * 2. Scans every game for SSE (steam_emu.ini next to Steam API DLL)
 * 3. For each SSE game: backs up, replaces DLL, converts config
 *
 * Safe to run multiple times — already-upgraded games are skipped.
 */
export const upgradeAllToGbe = defineDropTask({
  buildId: () => `upgrade:all-to-gbe:${new Date().toISOString()}`,
  name: "Upgrade All SSE Games to GBE",
  acls: ["system:maintenance:read"],
  taskGroup: "upgrade:all-to-gbe",

  async run({ progress, logger }) {
    logger.info("Starting batch SSE → GBE upgrade");

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

    logger.info(`Scanning ${games.length} game(s) for SSE installations`);

    let scanned = 0;
    let sseFound = 0;
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;

    for (const game of games) {
      scanned++;

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        progress(10 + Math.round((scanned / games.length) * 85));
        continue;
      }

      const detection = detectEmulator(versionDir);
      if (!detection || detection.type !== "sse") {
        // Not SSE — skip (already Goldberg or no emulator)
        if (detection?.type === "goldberg") {
          logger.info(`${game.mName} — already using Goldberg, skipping`);
        }
        progress(10 + Math.round((scanned / games.length) * 85));
        continue;
      }

      sseFound++;
      logger.info(
        `${game.mName} — SSE detected (AppID: ${detection.sseConfig?.appId ?? "unknown"})`,
      );

      // Check if already upgraded (backup file exists)
      const { dllDir, dllName } = detection;
      const backupPath = `${dllDir}/${dllName}.sse_backup`;
      const fs = await import("fs");
      if (fs.existsSync(backupPath)) {
        logger.info(`${game.mName} — backup already exists, skipping (already upgraded?)`);
        skipped++;
        progress(10 + Math.round((scanned / games.length) * 85));
        continue;
      }

      // Upgrade
      const result = await upgradeSseToGbe(
        versionDir,
        game.id,
        detection,
        logger,
      );

      if (result.success) {
        logger.info(`${game.mName} — ${result.message}`);
        upgraded++;
      } else {
        logger.info(`${game.mName} — FAILED: ${result.message}`);
        failed++;
      }

      progress(10 + Math.round((scanned / games.length) * 85));

      // Small delay between games to avoid hammering the filesystem
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info(
      `Done — scanned ${scanned}, found ${sseFound} SSE game(s): ` +
        `${upgraded} upgraded, ${skipped} already done, ${failed} failed`,
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
        logger.info(`  ${arch}: ${hasCachedDlls(arch) ? "✓ cached" : "✗ not found"}`);
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
