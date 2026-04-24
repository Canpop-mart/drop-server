import fs from "fs";
import path from "path";
import { defineDropTask } from "..";
import prisma from "../../db/database";
import { libraryManager } from "../../library";

/**
 * Walks every game version that claims a disk path and verifies the files
 * actually exist. Catches stale bind mounts, accidental deletions, and ACL
 * drift (i.e. the container can see the path but can't read into it).
 *
 * Does not mutate anything — reports only. Intended as a weekly canary.
 */
export default defineDropTask({
  buildId: () => `scan:library-health:${new Date().toISOString()}`,
  name: "Scan Library Health",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:library-health",

  async run({ progress, logger }) {
    const versions = await prisma.gameVersion.findMany({
      where: { versionPath: { not: null } },
      select: {
        versionId: true,
        versionPath: true,
        displayName: true,
        game: {
          select: {
            mName: true,
            libraryId: true,
            libraryPath: true,
          },
        },
      },
    });

    logger.info(`Checking ${versions.length} version(s) across libraries`);

    let ok = 0;
    let missingDir = 0;
    let unreadable = 0;
    let emptyDir = 0;
    let libraryOffline = 0;

    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      const label = `${v.game.mName} / ${v.displayName ?? v.versionPath}`;

      const library = libraryManager.getLibrary(v.game.libraryId);
      if (!library) {
        logger.info(`${label} — library offline (${v.game.libraryId})`);
        libraryOffline++;
        progress(Math.round(((i + 1) / versions.length) * 100));
        continue;
      }

      const versionDir = library.resolveVersionDir(
        v.game.libraryPath,
        v.versionPath!,
      );
      if (!versionDir) {
        logger.info(`${label} — could not resolve disk path`);
        missingDir++;
        progress(Math.round(((i + 1) / versions.length) * 100));
        continue;
      }

      if (!fs.existsSync(versionDir)) {
        logger.info(`${label} — directory missing: ${versionDir}`);
        missingDir++;
        progress(Math.round(((i + 1) / versions.length) * 100));
        continue;
      }

      try {
        const entries = fs.readdirSync(versionDir);
        if (entries.length === 0) {
          logger.info(`${label} — directory exists but is empty: ${versionDir}`);
          emptyDir++;
        } else {
          // Spot-check that we can actually stat one of the entries —
          // catches the case where the dir is listable but files inside
          // are owned by a uid the container can't read (Synology ACL).
          const sample = path.join(versionDir, entries[0]);
          fs.statSync(sample);
          ok++;
        }
      } catch (e) {
        logger.info(
          `${label} — unreadable at ${versionDir}: ${e instanceof Error ? e.message : String(e)}`,
        );
        unreadable++;
      }

      progress(Math.round(((i + 1) / versions.length) * 100));
    }

    logger.info(
      `Library health: ${ok} OK, ${missingDir} missing, ${unreadable} unreadable, ${emptyDir} empty, ${libraryOffline} library-offline`,
    );
  },
});
