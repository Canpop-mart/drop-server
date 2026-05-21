/**
 * Import phase 1 — prepare the version directory.
 *
 * Resolves the real on-disk path for the version, and for multi-disc
 * games materialises a persistent staging directory of junctions to
 * each disc folder (pruning any dead junctions first). Depot imports
 * have no local filesystem, so this phase is a near no-op for them.
 *
 * Phase label: [PHASE:directory]
 */

import fs from "fs";
import path from "path";
import type { ImportContext, PreparedDirectory } from "./types";

const PHASE = "[PHASE:directory]";

/**
 * Prunes junctions inside `stagingDir` whose target no longer exists.
 * Returns the names of pruned entries. Logs each removal.
 */
function pruneDeadJunctions(
  stagingDir: string,
  logger: ImportContext["logger"],
): string[] {
  const pruned: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  } catch {
    return pruned;
  }

  for (const entry of entries) {
    // Junctions report as symbolic links on Windows.
    if (!entry.isSymbolicLink()) continue;
    const linkPath = path.join(stagingDir, entry.name);
    let targetExists = false;
    try {
      // fs.existsSync follows the link — false means a dead junction.
      targetExists = fs.existsSync(linkPath);
    } catch {
      targetExists = false;
    }
    if (targetExists) continue;
    try {
      fs.rmSync(linkPath, { recursive: false, force: true });
      pruned.push(entry.name);
      logger.warn(
        `${PHASE} Pruned dead junction "${entry.name}" (target missing) in ${stagingDir}`,
      );
    } catch (e) {
      logger.warn(
        `${PHASE} Failed to prune dead junction "${entry.name}": ${e}`,
      );
    }
  }
  return pruned;
}

export async function prepareVersionDirectory(
  ctx: ImportContext,
): Promise<PreparedDirectory> {
  const { version, library, logger, dryRun } = ctx;

  // ── Depot imports — manifest already exists, no filesystem work ──────
  if (version.type === "depot") {
    logger.info(
      `${PHASE} Depot version "${version.name}" — using stored manifest, no directory prep needed`,
    );
    return { versionPath: null, prunedJunctions: 0 };
  }

  if (version.type !== "local") {
    throw new Error(`${PHASE} Unsupported version type: ${version.type}`);
  }

  const versionPath = version.identifier;
  const effectiveLibraryPath = ctx.isMultiDisc
    ? ctx.discFolders[0]
    : ctx.libraryPath;

  // ── Single-disc — just resolve the real directory ────────────────────
  if (!ctx.isMultiDisc) {
    const versionDir = library.resolveVersionDir(
      effectiveLibraryPath,
      versionPath,
    );
    if (!versionDir) {
      throw new Error(
        `${PHASE} Could not resolve version directory for ` +
          `"${effectiveLibraryPath}/${versionPath}"`,
      );
    }
    logger.info(`${PHASE} Resolved version directory: ${versionDir}`);
    return { versionDir, versionPath, prunedJunctions: 0 };
  }

  // ── Multi-disc — materialise the staging junction farm ───────────────
  const baseDir = library.resolveVersionDir(ctx.discFolders[0], versionPath);
  if (!baseDir) {
    throw new Error(
      `${PHASE} Could not resolve disc folder: ${ctx.discFolders[0]}`,
    );
  }
  const libraryBase = path.dirname(baseDir);
  const multiDiscDirName = `.drop-multidisc-${ctx.gameId}`;
  const multiDiscDir = path.join(libraryBase, multiDiscDirName);

  logger.info(
    `${PHASE} Multi-disc game with ${ctx.discFolders.length} disc(s), ` +
      `staging at ${multiDiscDir}`,
  );

  if (dryRun) {
    // Dry-run: report what would happen, touch nothing on disk.
    logger.info(
      `${PHASE} Dry-run — would stage ${ctx.discFolders.length} disc junction(s) at ${multiDiscDir}`,
    );
    return {
      versionDir: fs.existsSync(multiDiscDir) ? multiDiscDir : baseDir,
      versionPath,
      newLibraryPath: multiDiscDirName,
      prunedJunctions: 0,
    };
  }

  fs.mkdirSync(multiDiscDir, { recursive: true });

  // Hygiene: prune dead junctions BEFORE (re)creating them, so a disc
  // folder that was renamed/removed doesn't leave a stale link behind.
  const pruned = pruneDeadJunctions(multiDiscDir, logger);

  for (const folder of ctx.discFolders) {
    const src = path.join(libraryBase, folder);
    const dest = path.join(multiDiscDir, folder);
    if (fs.existsSync(dest)) continue;
    if (!fs.existsSync(src)) {
      logger.warn(
        `${PHASE} Disc source folder missing, cannot link: ${folder}`,
      );
      ctx.warnings.push(`Disc folder missing on disk: ${folder}`);
      continue;
    }
    fs.symlinkSync(src, dest, "junction");
    logger.info(`${PHASE} Linked disc folder: ${folder}`);
  }

  return {
    versionDir: multiDiscDir,
    versionPath,
    newLibraryPath: multiDiscDirName,
    prunedJunctions: pruned.length,
  };
}
