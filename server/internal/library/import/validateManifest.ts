/**
 * Import phase 4 — post-manifest validation (NEW).
 *
 * Walks every file referenced by the freshly-generated manifest, stats
 * it on disk, and confirms the on-disk size matches the size the
 * manifest claims. If any file is missing or has the wrong size the
 * import is REJECTED — `ManifestValidationError` is thrown so the
 * orchestrator never writes the GameVersion row.
 *
 * Skipped for depot imports (manifest came from a trusted prior import)
 * and for dry-runs (no real manifest was generated).
 *
 * Phase label: [PHASE:validate]
 */

import path from "path";
import { dropletInterface } from "../../services/torrential/droplet-interface";
import {
  ManifestValidationError,
  type ImportContext,
  type ManifestResult,
  type ManifestValidationResult,
  type PreparedDirectory,
} from "./types";

const PHASE = "[PHASE:validate]";

/**
 * Folds a V2 manifest down to `filename → total declared length`.
 * A file may be split across multiple chunks, so its true size is the
 * sum of every chunk entry's `length` for that filename.
 */
function declaredFileSizes(
  manifest: ManifestResult["manifest"],
): { sizes: Map<string, number>; chunkCount: number } {
  const sizes = new Map<string, number>();
  const chunkKeys = Object.keys(manifest.chunks ?? {});
  for (const key of chunkKeys) {
    const chunk = manifest.chunks[key];
    for (const entry of chunk.files ?? []) {
      sizes.set(
        entry.filename,
        (sizes.get(entry.filename) ?? 0) + entry.length,
      );
    }
  }
  return { sizes, chunkCount: chunkKeys.length };
}

export async function validateManifest(
  ctx: ImportContext,
  prepared: PreparedDirectory,
  manifestResult: ManifestResult,
): Promise<ManifestValidationResult> {
  const { logger, version } = ctx;
  const { sizes, chunkCount } = declaredFileSizes(manifestResult.manifest);
  const fileCount = sizes.size;
  let totalSizeBytes = 0;
  for (const s of sizes.values()) totalSizeBytes += s;

  // ── Depot / dry-run — nothing to stat on disk ────────────────────────
  if (version.type === "depot") {
    logger.info(
      `${PHASE} Depot import — skipping on-disk validation ` +
        `(${fileCount} files, ${totalSizeBytes} bytes from stored manifest)`,
    );
    return { fileCount, totalSizeBytes, chunkCount };
  }
  if (ctx.dryRun) {
    logger.info(`${PHASE} Dry-run — on-disk validation skipped`);
    return { fileCount, totalSizeBytes, chunkCount };
  }

  if (!prepared.versionDir) {
    throw new Error(`${PHASE} No version directory to validate against`);
  }

  logger.info(
    `${PHASE} Validating ${fileCount} manifest file(s) against disk in ${prepared.versionDir}`,
  );

  const missing: string[] = [];
  const mismatched: string[] = [];
  let checked = 0;

  for (const [filename, declaredSize] of sizes) {
    if (ctx.task.signal.aborted) {
      throw new Error(`${PHASE} Validation aborted by operator`);
    }
    // The manifest stores POSIX-style relative paths; peekFile splits a
    // base dir + relative filename. droplet's peekFile returns the
    // on-disk byte size, or throws / returns 0 when the file is absent.
    let onDiskSize: number | undefined;
    try {
      onDiskSize = await dropletInterface.peekFile(
        prepared.versionDir,
        filename,
      );
    } catch {
      onDiskSize = undefined;
    }

    if (onDiskSize === undefined || onDiskSize < 0) {
      missing.push(filename);
    } else if (onDiskSize !== declaredSize) {
      mismatched.push(
        `${filename} (manifest=${declaredSize}, disk=${onDiskSize})`,
      );
    }
    checked++;
    // Light progress within the 90–100% band the orchestrator reserves
    // for post-manifest work.
    if (checked % 50 === 0) {
      logger.info(`${PHASE} Validated ${checked}/${fileCount} files...`);
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    for (const m of missing.slice(0, 20)) {
      logger.warn(`${PHASE} MISSING: ${path.normalize(m)}`);
    }
    for (const m of mismatched.slice(0, 20)) {
      logger.warn(`${PHASE} SIZE MISMATCH: ${m}`);
    }
    logger.warn(
      `${PHASE} Validation FAILED — ${missing.length} missing, ` +
        `${mismatched.length} mismatched. Rejecting import.`,
    );
    throw new ManifestValidationError(missing, mismatched);
  }

  logger.info(
    `${PHASE} Validation OK — ${fileCount} files, ${totalSizeBytes} bytes, ` +
      `${chunkCount} chunk(s)`,
  );
  return { fileCount, totalSizeBytes, chunkCount };
}
