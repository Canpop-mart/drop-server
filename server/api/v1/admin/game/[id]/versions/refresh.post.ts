import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { libraryManager } from "~/server/internal/library";
import { taskHandler, wrapTaskContext } from "~/server/internal/tasks";
import type { Platform } from "~/prisma/client/client";
import { GameType } from "~/prisma/client/enums";
import {
  preserveVersionSettings,
  settingsForDiscoveredVersion,
} from "~/server/internal/library/versionRefresh";

/**
 * Refresh versions for a single game: purges all existing versions,
 * re-discovers available versions from the library source, and
 * re-imports them using the same logic as the mass-import endpoint.
 *
 * Settings made by hand on a version survive, matched by version folder (see
 * versionRefresh.ts): a mod's install folder, launch override and launches,
 * and every version's prerequisite links in both directions. Launches of
 * other game types are detected again, as before.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, [
    "game:version:delete",
    "import:version:new",
  ]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      mName: true,
      type: true,
      libraryId: true,
      libraryPath: true,
      versions: { select: { versionPath: true } },
      unimportedGameVersions: { select: { id: true, versionName: true } },
    },
  });

  if (!game || !game.libraryId) {
    throw createError({ statusCode: 404, statusMessage: "Game not found" });
  }

  const taskId = await taskHandler.create({
    key: `refresh-versions-${gameId}`,
    taskGroup: "import:version",
    acls: ["system:import:version:read"],
    name: `Refreshing versions for ${game.mName}`,
    async run({ progress, logger, addAction, markPhase, signal }) {
      const isMod = game.type === GameType.Mod;
      const preserved = preserveVersionSettings(
        gameId,
        await prisma.gameVersion.findMany({
          where: { gameId },
          select: {
            versionPath: true,
            modInstallDir: true,
            launchOverride: true,
            launches: {
              select: {
                platform: true,
                name: true,
                command: true,
                emulatorId: true,
                discPaths: true,
              },
            },
            requiredContent: { select: { versionId: true, gameId: true } },
            requiringContent: { select: { versionId: true, gameId: true } },
          },
        }),
      );
      logger.info(
        `Keeping hand-set settings for ${preserved.size} version folder(s)`,
      );

      logger.info(`Purging existing versions for ${game.mName}`);
      const { count } = await prisma.gameVersion.deleteMany({
        where: { gameId },
      });
      logger.info(`Purged ${count} version(s)`);
      progress(10);

      logger.info("Discovering available versions...");
      const discoveredVersions =
        await libraryManager.fetchUnimportedGameVersions(
          game.libraryId!,
          game.libraryPath,
        );

      if (!discoveredVersions || discoveredVersions.length === 0) {
        logger.warn("No versions discovered — game may need manual import");
        progress(100);
        return;
      }

      logger.info(`Found ${discoveredVersions.length} version(s) to import`);
      progress(20);

      for (let i = 0; i < discoveredVersions.length; i++) {
        const version = discoveredVersions[i];
        const preload = await libraryManager.fetchUnimportedVersionInformation(
          gameId,
          {
            type: version.type,
            identifier: version.identifier,
          },
        );

        if (!preload || preload.length === 0) {
          logger.warn(`No preload info for ${version.name} — skipping`);
          continue;
        }

        const kept = settingsForDiscoveredVersion(preserved, version);

        const launches: Array<{
          platform: Platform;
          launch: string;
          name: string;
          emulatorId?: string;
          discPaths?: string[];
        }> = [];
        const setups: Array<{ platform: Platform; launch: string }> = [];

        // A mod is a file overlay: it usually has no launch at all, which is
        // what makes the client offer it on every platform. Guessing one here
        // (as for a game) would quietly tie it to whatever platform the guess
        // landed on, so a mod keeps exactly the launches it had.
        const seenPlatforms = new Set<Platform>();
        if (isMod) launches.push(...(kept?.launches ?? []));
        for (const guess of isMod ? [] : preload) {
          if (seenPlatforms.has(guess.platform)) continue;
          seenPlatforms.add(guess.platform);

          if (guess.type === "emulator") {
            launches.push({
              platform: guess.platform,
              launch: guess.filename,
              name: guess.launchName,
              emulatorId: guess.emulatorId,
            });
          } else {
            launches.push({
              platform: guess.platform,
              launch: guess.filename,
              name: "Play",
            });
          }
        }

        if (launches.length === 0 && !isMod) {
          const fallback = preload[0];
          if (fallback.type === "emulator") {
            launches.push({
              platform: fallback.platform,
              launch: fallback.filename,
              name: fallback.launchName,
              emulatorId: fallback.emulatorId,
            });
          } else {
            launches.push({
              platform: fallback.platform,
              launch: fallback.filename,
              name: "Play",
            });
          }
        }

        logger.info(`Importing ${version.name}`);
        const min = 20 + (i / discoveredVersions.length) * 80;
        const max = 20 + ((i + 1) / discoveredVersions.length) * 80;

        await libraryManager.importVersion(
          gameId,
          {
            type: version.type,
            identifier: version.identifier,
            name: version.name,
          },
          {
            id: gameId,
            version: {
              type: version.type,
              identifier: version.identifier,
              name: version.name,
            },
            launches,
            setups,
            onlySetup: false,
            delta: false,
            modInstallDir: kept?.modInstallDir,
            launchOverride: kept?.launchOverride,
            // Only ids that still exist: connecting a missing one would fail
            // the whole import.
            requiredContent: await existingVersionIds(
              kept?.requiredContent ?? [],
            ),
          },
          wrapTaskContext(
            { logger, progress, addAction, markPhase, signal },
            { min, max, prefix: version.name },
          ),
        );

        // Versions of other games that listed this one as required pointed at
        // the row the purge deleted. Point them at its replacement.
        const requiring = await existingVersionIds(
          kept?.requiringContent ?? [],
        );
        if (requiring.length > 0) {
          const replacement = await prisma.gameVersion.findFirst({
            where: { gameId, versionPath: version.identifier },
            orderBy: { versionIndex: "desc" },
            select: { versionId: true },
          });
          if (replacement) {
            // updateMany cannot connect relations. The row was read just
            // above, inside this task, so update() cannot miss it.
            // eslint-disable-next-line drop/no-prisma-delete
            await prisma.gameVersion.update({
              where: { versionId: replacement.versionId },
              data: {
                requiringContent: {
                  connect: requiring.map((versionId) => ({ versionId })),
                },
              },
            });
            logger.info(
              `Relinked ${requiring.length} version(s) that require ${version.name}`,
            );
          } else {
            logger.warn(
              `${version.name} did not import, so ${requiring.length} version(s) that required it now have no link to it`,
            );
          }
        }

        logger.info(`Finished import for ${version.name}`);
        progress(max);
      }
    },
  });

  return { taskId };
});

/** The subset of `ids` that are still version rows. */
async function existingVersionIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.gameVersion.findMany({
    where: { versionId: { in: ids } },
    select: { versionId: true },
  });
  return rows.map((r) => r.versionId);
}
