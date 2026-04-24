import { defineDropTask } from "..";
import prisma from "../../db/database";
import { libraryManager } from "../../library";

/**
 * Lists top-level game folders present on disk but not referenced by any
 * Game row (and vice versa). Report-only — never deletes, because game
 * folders are typically multi-GB and the deployer should make the call.
 *
 * Counterpart to `cleanup:objects`, which handles unreferenced object
 * storage entries. /library is explicitly not swept automatically because
 * the downside of a false positive is catastrophic.
 */
export default defineDropTask({
  buildId: () => `cleanup:library-orphans:${new Date().toISOString()}`,
  name: "Scan Library Orphans",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:library-orphans",

  async run({ progress, logger }) {
    const libraries = await prisma.library.findMany({
      select: { id: true, name: true },
    });

    if (libraries.length === 0) {
      logger.info("No libraries configured");
      progress(100);
      return;
    }

    let totalOrphans = 0;
    let totalMissing = 0;

    for (let i = 0; i < libraries.length; i++) {
      const lib = libraries[i];
      logger.info(`── Library: ${lib.name} ──`);

      const provider = libraryManager.getLibrary(lib.id);
      if (!provider) {
        logger.info(`  library offline, skipping`);
        progress(Math.round(((i + 1) / libraries.length) * 100));
        continue;
      }

      let onDisk: string[];
      try {
        onDisk = await provider.listGames();
      } catch (e) {
        logger.info(
          `  failed to list games: ${e instanceof Error ? e.message : String(e)}`,
        );
        progress(Math.round(((i + 1) / libraries.length) * 100));
        continue;
      }

      const inDb = await prisma.game.findMany({
        where: { libraryId: lib.id },
        select: { libraryPath: true, discFolders: true, mName: true },
      });

      // Disc-based games use an abstract libraryPath base name; the real
      // folders live under discFolders[]. Include both so neither direction
      // flags them as an orphan.
      const knownPaths = new Set<string>();
      for (const g of inDb) {
        knownPaths.add(g.libraryPath);
        for (const disc of g.discFolders ?? []) knownPaths.add(disc);
      }

      const diskSet = new Set(onDisk);

      const orphansOnDisk = onDisk.filter((p) => !knownPaths.has(p));
      const missingOnDisk = inDb.filter(
        (g) =>
          !diskSet.has(g.libraryPath) &&
          !(g.discFolders ?? []).some((d) => diskSet.has(d)),
      );

      if (orphansOnDisk.length === 0) {
        logger.info(`  no orphans on disk`);
      } else {
        logger.info(`  ${orphansOnDisk.length} folder(s) on disk not in DB:`);
        for (const p of orphansOnDisk) logger.info(`    - ${p}`);
        totalOrphans += orphansOnDisk.length;
      }

      if (missingOnDisk.length === 0) {
        logger.info(`  no DB rows missing from disk`);
      } else {
        logger.info(
          `  ${missingOnDisk.length} DB row(s) with no matching folder:`,
        );
        for (const g of missingOnDisk)
          logger.info(`    - ${g.mName} (${g.libraryPath})`);
        totalMissing += missingOnDisk.length;
      }

      progress(Math.round(((i + 1) / libraries.length) * 100));
    }

    logger.info(
      `Totals: ${totalOrphans} orphan folder(s) on disk, ${totalMissing} DB row(s) missing from disk. No changes made.`,
    );
  },
});
