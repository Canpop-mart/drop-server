import { defineDropTask } from "..";
import prisma from "../../db/database";
import { resolveGameVersionDir } from "../../goldberg";
import { libraryManager } from "../../library";
import { restoreSteamBackup } from "../../gbe";

/**
 * Recovery task — restores `.steam_backup` DLLs that the old opt-out
 * GBE swap path destroyed.
 *
 * Until this branch landed, `setupGoldberg` would assume any DLL without
 * a Goldberg signature was vanilla Valve Steamworks and would overwrite
 * it with the cached GBE build, preserving the original as
 * `<dll>.steam_backup`. That assumption was wrong for pre-fixed games
 * shipping OnlineFix / CODEX / EMPRESS / CreamAPI / custom builds — the
 * working crack got moved to `.steam_backup` and replaced by a fresh
 * GBE DLL that won't pass DRM checks.
 *
 * This task walks every library, finds every `*.steam_backup` file, and
 * restores the original DLL in place. The currently-installed (likely
 * GBE) DLL is stashed aside as `*.gbe_backup` rather than thrown away,
 * so the swap can be re-applied if the original turns out to be broken.
 *
 * After every successful restore the game's droplet manifest is
 * regenerated so client checksums match the bytes on disk again.
 *
 * Idempotent — running it on a library with no `.steam_backup` files is
 * a no-op and reports zero restored.
 */
export default defineDropTask({
  buildId: () => `restore:steam-backup:${new Date().toISOString()}`,
  name: "Restore .steam_backup DLLs",
  acls: ["system:maintenance:read"],
  taskGroup: "restore:steam-backup",

  async run({ progress, logger }) {
    const games = await prisma.game.findMany({
      select: { id: true, mName: true },
    });

    if (games.length === 0) {
      logger.info("No games found");
      progress(100);
      return;
    }

    logger.info(`Scanning ${games.length} game(s) for .steam_backup files`);

    let scanned = 0;
    let restored = 0;
    let failed = 0;
    let regenerated = 0;
    let regenFailed = 0;
    const restoredGames: string[] = [];

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      scanned++;

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      const results = restoreSteamBackup(versionDir);
      if (results.length === 0) {
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      let restoredAny = false;
      for (const result of results) {
        if (result.restored) {
          logger.info(
            `${game.mName} — restored ${result.dllPath}${result.note ? " (" + result.note + ")" : ""}`,
          );
          restored++;
          restoredAny = true;
        } else {
          logger.warn(
            `${game.mName} — restore FAILED for ${result.dllPath}: ${result.note ?? "no detail"}`,
          );
          failed++;
        }
      }

      // Regenerate the manifest so the manifest checksums match what's
      // on disk now (otherwise clients re-downloading would replay the
      // GBE DLL and undo the restore on the next sync).
      if (restoredAny) {
        restoredGames.push(game.mName);
        try {
          const regenOk =
            await libraryManager.regenerateManifestForLatestVersion(
              game.id,
              logger,
            );
          if (regenOk) {
            regenerated++;
            logger.info(`${game.mName} — manifest regenerated`);
          } else {
            regenFailed++;
            logger.warn(
              `${game.mName} — manifest regen did NOT complete; clients may hit checksum mismatches until re-imported`,
            );
          }
        } catch (e) {
          regenFailed++;
          logger.warn(
            `${game.mName} — manifest regen threw: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      progress(Math.round(((i + 1) / games.length) * 100));
    }

    logger.info(
      `Done — scanned ${scanned} game(s). ` +
        `${restored} DLL(s) restored across ${restoredGames.length} game(s), ` +
        `${failed} restore failure(s), ` +
        `${regenerated} manifest(s) regenerated, ${regenFailed} regen failure(s).`,
    );

    if (restored === 0) {
      logger.info(
        "No .steam_backup files were found. If you expected restores, " +
          "verify the broken games still have .steam_backup files next to " +
          "their steam_api64.dll on disk.",
      );
    } else if (restoredGames.length > 0) {
      logger.info(`Restored games: ${restoredGames.join(", ")}`);
    }
  },
});
