import { defineDropTask } from "..";
import prisma from "../../db/database";
import { libraryManager } from "../../library";

/**
 * Re-hashes every game's latest version and rewrites its droplet manifest.
 *
 * Needed after any server-side mutation of on-disk files that didn't go
 * through the GBE upgrade task — most commonly: a manual DLL swap. Once
 * the bytes on disk stop matching the checksums stored in the manifest,
 * clients fail download with `ApplicationDownloadError::Checksum`
 * (see drop-app/src-tauri/games/src/downloads/download_logic.rs:173).
 *
 * The GBE upgrade task also regenerates manifests but skips games whose
 * DLLs already look like Goldberg, so this task exists for the "already
 * swapped but manifest never regenerated" case.
 *
 * Idempotent — safe to re-run. Skips multi-disc games (same constraint
 * as regenerateManifestForLatestVersion).
 */
export default defineDropTask({
  buildId: () => `regenerate:manifests:${new Date().toISOString()}`,
  name: "Regenerate Manifests",
  acls: ["system:maintenance:read"],
  taskGroup: "regenerate:manifests",

  async run({ progress, logger }) {
    const games = await prisma.game.findMany({
      select: { id: true, mName: true },
    });

    if (games.length === 0) {
      logger.info("No games found");
      progress(100);
      return;
    }

    logger.info(`Regenerating manifests for ${games.length} game(s)`);

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];

      try {
        const regenOk = await libraryManager.regenerateManifestForLatestVersion(
          game.id,
          logger,
        );
        if (regenOk) {
          ok++;
        } else {
          // regenerateManifestForLatestVersion logs its own reason
          skipped++;
        }
      } catch (e) {
        logger.warn(
          `${game.mName} — regen threw: ${e instanceof Error ? e.message : String(e)}`,
        );
        failed++;
      }

      progress(Math.round(((i + 1) / games.length) * 100));
    }

    logger.info(
      `Done — ${ok} regenerated, ${skipped} skipped, ${failed} failed`,
    );
  },
});
