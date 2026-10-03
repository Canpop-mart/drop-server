/**
 * Import phase 5 — per-file hashes (revision 1 snapshot).
 *
 * Reads every file once more and records { path, size, sha256 } for the new
 * version's first revision, checking the bytes against the manifest's chunk
 * checksums in the same pass (revisions/hash.ts). Clients use the snapshot as
 * the baseline for in-place updates.
 *
 * Never fails the import: if hashing goes wrong the version is imported
 * without a snapshot, with a warning on the receipt, and an admin can record
 * one later with "Record fingerprints" in the version editor. Skipped for depot imports (no local files), archive
 * versions (a zip or similar instead of a folder) and dry runs.
 *
 * Phase label: [PHASE:hash]
 */

import fs from "node:fs";
import { snapshotFromManifest, type VerifiedSnapshot } from "../revisions/hash";
import type { ImportContext, ManifestResult, PreparedDirectory } from "./types";

const PHASE = "[PHASE:hash]";

export async function hashVersionFiles(
  ctx: ImportContext,
  prepared: PreparedDirectory,
  manifestResult: ManifestResult,
): Promise<VerifiedSnapshot | null> {
  const { logger } = ctx;
  if (ctx.dryRun) {
    logger.info(`${PHASE} Dry-run: file hashes not recorded`);
    return null;
  }
  if (ctx.version.type === "depot" || !prepared.versionDir) {
    logger.info(`${PHASE} No local files (depot import): hashes skipped`);
    return null;
  }
  let isDir = false;
  try {
    isDir = fs.statSync(prepared.versionDir).isDirectory();
  } catch {
    // Not stat-able: skipped below with the same message as an archive.
  }
  if (!isDir) {
    logger.info(
      `${PHASE} Version is not a folder (an archive, for example): hashes skipped, in-place updates need a folder`,
    );
    return null;
  }

  try {
    const snapshot = await snapshotFromManifest(
      prepared.versionDir,
      manifestResult.manifest,
      {
        signal: ctx.task.signal,
        logger,
        onProgress: (f) => ctx.task.progress(90 + Math.floor(f * 9)),
      },
    );
    if (snapshot.unknown.length > 0) {
      const msg =
        `${snapshot.unknown.length} file(s) changed while the version was being imported; ` +
        `their hashes are recorded as unknown`;
      logger.warn(`${PHASE} ${msg}`);
      ctx.warnings.push(msg);
    }
    logger.info(
      `${PHASE} Hashed ${snapshot.files.length - snapshot.unknown.length} file(s)`,
    );
    return snapshot;
  } catch (e) {
    if (ctx.task.signal.aborted) throw e;
    const msg = `File hashes not recorded (${e}); the background hashing will retry after a restart`;
    logger.warn(`${PHASE} ${msg}`);
    ctx.warnings.push(msg);
    return null;
  }
}
