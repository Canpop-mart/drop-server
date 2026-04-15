import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { libraryManager } from "~/server/internal/library";
import { taskHandler, wrapTaskContext } from "~/server/internal/tasks";
import type { Platform } from "~/prisma/client/client";

/**
 * Refresh versions for a single game: purges all existing versions,
 * re-discovers available versions from the library source, and
 * re-imports them using the same logic as the mass-import endpoint.
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
    async run({ progress, logger, addAction }) {
      // Step 1: Purge existing versions
      logger.info(`Purging existing versions for ${game.mName}`);
      const { count } = await prisma.gameVersion.deleteMany({
        where: { gameId },
      });
      logger.info(`Purged ${count} version(s)`);
      progress(10);

      // Step 2: Discover available versions from the library
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

      // Step 3: Re-import each discovered version
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

        const launches: Array<{
          platform: Platform;
          launch: string;
          name: string;
          emulatorId?: string;
        }> = [];
        const setups: Array<{ platform: Platform; launch: string }> = [];

        const seenPlatforms = new Set<Platform>();
        for (const guess of preload) {
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

        if (launches.length === 0) {
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
            requiredContent: [],
          },
          wrapTaskContext(
            { logger, progress, addAction },
            { min, max, prefix: version.name },
          ),
        );

        logger.info(`Finished import for ${version.name}`);
        progress(max);
      }
    },
  });

  return { taskId };
});
