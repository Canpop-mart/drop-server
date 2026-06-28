import { defineDropTask } from "..";
import prisma from "../../db/database";
import { libraryManager } from "../../library";
import type { UnimportedVersionInformation } from "../../library";
import { resolveGameVersionDir } from "../../goldberg";
import {
  findAllSteamApiDlls,
  isGbeDll,
  detectAntiCheat,
  detectCrackLoader,
  hasBundledGbeForDll,
} from "../../gbe";
import { LibraryBackend } from "~/prisma/client/enums";
import type { ImportVersion } from "~/server/api/v1/admin/import/version/index.post";
import path from "path";

/**
 * Backfill the Plan B GBE swap onto already-imported games by publishing a NEW
 * GameVersion per game.
 *
 * The swap is wired into the import pipeline (setupEmulators -> setupGoldberg),
 * so re-importing an existing on-disk version runs the swap and persists a fresh
 * GameVersion at versionIndex+1. Clients sync the new latest version and re-pull
 * the GBE bytes. A NEW version (not an in-place manifest regen) is required: an
 * already-installed client only re-downloads when the version changes — an
 * in-place regen would leave its old DLL silently mismatching the new manifest.
 *
 * Idempotent + re-runnable: games already on GBE (or that never swap, e.g.
 * anti-cheat) are pre-checked on disk and skipped so the task doesn't churn
 * identical versions. Emulator and multi-disc games are skipped (not GBE
 * targets, and their launch config is risky to rebuild from the DB).
 */
export default defineDropTask({
  buildId: () => `backfill:gbe-swap:${new Date().toISOString()}`,
  name: "Backfill GBE Swap (publish new versions)",
  acls: ["system:maintenance:read"],
  taskGroup: "backfill:gbe-swap",

  async run(ctx) {
    const { progress, logger } = ctx;

    const games = await prisma.game.findMany({
      where: {
        library: {
          backend: {
            in: [LibraryBackend.Filesystem, LibraryBackend.FlatFilesystem],
          },
          autoEmulatorSetup: true,
        },
      },
      select: {
        id: true,
        mName: true,
        discFolders: true,
        versions: {
          orderBy: { versionIndex: "desc" },
          take: 1,
          select: {
            versionPath: true,
            displayName: true,
            onlySetup: true,
            launches: {
              select: {
                name: true,
                command: true,
                platform: true,
                emulatorId: true,
                emulatorSuggestions: true,
                discPaths: true,
                umuIdOverride: true,
              },
            },
            setups: { select: { command: true, platform: true } },
          },
        },
      },
    });

    if (games.length === 0) {
      logger.info(
        "No filesystem games with autoEmulatorSetup — nothing to backfill",
      );
      progress(100);
      return;
    }

    logger.info(`Backfill GBE swap: scanning ${games.length} game(s)`);

    let swapped = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < games.length; i++) {
      if (ctx.signal?.aborted) {
        logger.info("Backfill cancelled — stopping before the next game");
        break;
      }

      const game = games[i];
      const reportProgress = () =>
        progress(Math.round(((i + 1) / games.length) * 100));

      try {
        const latest = game.versions[0];
        if (!latest || !latest.versionPath) {
          logger.info(`${game.mName} — no importable version, skipping`);
          skipped++;
          reportProgress();
          continue;
        }
        if (game.discFolders && game.discFolders.length > 1) {
          logger.info(
            `${game.mName} — multi-disc, skipping (re-import manually)`,
          );
          skipped++;
          reportProgress();
          continue;
        }
        if (latest.launches.some((l) => l.emulatorId)) {
          logger.info(
            `${game.mName} — emulator game, skipping (not a GBE target)`,
          );
          skipped++;
          reportProgress();
          continue;
        }

        const versionDir = await resolveGameVersionDir(game.id);
        if (!versionDir) {
          logger.info(`${game.mName} — no version directory, skipping`);
          skipped++;
          reportProgress();
          continue;
        }

        // A loader crack (OnlineFix/Cream) is left in place by the import swap
        // (its safe removal is the separate OnlineFix-removal step), so a
        // re-import would churn a byte-identical version — skip.
        const loader = detectCrackLoader(versionDir);
        if (loader) {
          logger.info(`${game.mName} — loader crack (${loader}), skipping`);
          skipped++;
          reportProgress();
          continue;
        }

        const antiCheat = detectAntiCheat(versionDir);
        if (antiCheat) {
          logger.info(`${game.mName} — anti-cheat (${antiCheat}), skipping`);
          skipped++;
          reportProgress();
          continue;
        }

        // Only re-import if at least one steam_api DLL will ACTUALLY be swapped:
        // it must be non-GBE AND have a bundled GBE binary for its arch. Checking
        // every DLL (not just the first) keeps multi-arch games correct, and the
        // bundle check stops the task from publishing a byte-identical version
        // that forces a pointless client re-pull (and never converges).
        const dlls = findAllSteamApiDlls(versionDir);
        if (dlls.length === 0) {
          logger.info(`${game.mName} — no steam_api DLL, skipping`);
          skipped++;
          reportProgress();
          continue;
        }
        const willSwap = dlls.some(
          (d) =>
            !isGbeDll(path.join(d.dllDir, d.dllName)) &&
            hasBundledGbeForDll(d.dllName),
        );
        if (!willSwap) {
          logger.info(
            `${game.mName} — already GBE (or no bundled GBE for its arch), skipping`,
          );
          skipped++;
          reportProgress();
          continue;
        }

        // Rebuild the import body from the existing latest version so the new
        // version keeps the same launch/setup config. These games have no
        // emulatorId (guarded above), so there's no dangling self-reference to
        // an old launch row.
        const version: UnimportedVersionInformation = {
          type: "local",
          identifier: latest.versionPath,
          name: latest.displayName ?? latest.versionPath,
        };
        const metadata: typeof ImportVersion.infer = {
          id: game.id,
          version,
          displayName: latest.displayName ?? undefined,
          launches: latest.launches.map((l) => ({
            platform: l.platform,
            name: l.name,
            launch: l.command,
            umuId: l.umuIdOverride ?? undefined,
            emulatorId: undefined,
            suggestions: l.emulatorSuggestions,
            discPaths: l.discPaths,
          })),
          setups: latest.setups.map((s) => ({
            platform: s.platform,
            launch: s.command,
          })),
          onlySetup: latest.onlySetup,
          delta: false,
          requiredContent: [],
        };

        logger.info(`${game.mName} — publishing a new GBE-swapped version...`);
        await libraryManager.importVersion(game.id, version, metadata, ctx);
        swapped++;
        logger.info(`${game.mName} — done`);
      } catch (e) {
        failed++;
        logger.warn(
          `${game.mName} — backfill failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      reportProgress();
    }

    logger.info(
      `Backfill GBE swap: ${swapped} swapped, ${skipped} skipped, ${failed} failed`,
    );
  },
});
