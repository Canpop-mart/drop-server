/**
 * The first snapshot of a version that has none yet: every version imported
 * before revisions existed, until an admin presses "Record fingerprints" or
 * "Check for changes" on it. Nothing records them automatically.
 */

import prisma from "../../db/database";
import { castManifest } from "../manifest/utils";
import { snapshotFromManifest, type HashRunOptions } from "./hash";
import {
  readSnapshot,
  writeCurrentSnapshot,
  type StoredSnapshot,
} from "./store";
import type { RevisionTarget } from "./target";

export type BaselineResult = {
  snapshot: StoredSnapshot;
  /** False when the snapshot already existed and nothing was hashed. */
  created: boolean;
  /** Files recorded with an unknown hash. */
  unknown: number;
  mismatchedChunks: number;
};

/**
 * Returns the snapshot of the version's current revision, creating it from
 * the stored manifest and the files on disk if it doesn't exist.
 *
 * The caller must hold the version lock (`withVersionLock`), so the manifest
 * and revision read here can't change underneath.
 */
export async function ensureBaseline(
  target: RevisionTarget,
  opts: HashRunOptions = {},
): Promise<BaselineResult> {
  const version = await prisma.gameVersion.findUnique({
    where: { versionId: target.versionId },
    select: { revision: true, dropletManifest: true },
  });
  if (!version) throw new Error("The version was deleted.");

  const existing = await readSnapshot(target.versionId, version.revision);
  if (existing) {
    return {
      snapshot: existing,
      created: false,
      unknown: 0,
      mismatchedChunks: 0,
    };
  }

  opts.logger?.info(
    `Recording file hashes for ${target.gameName} (${target.versionName}), revision ${version.revision}`,
  );
  const result = await snapshotFromManifest(
    target.versionDir,
    castManifest(version.dropletManifest),
    opts,
  );
  const written = await writeCurrentSnapshot({
    gameId: target.gameId,
    versionId: target.versionId,
    revision: version.revision,
    files: result.files,
    cache: result.cache,
  });
  if (!written) {
    // Only possible if something outside the version lock changed the row.
    const now = await readSnapshot(target.versionId, version.revision);
    if (!now)
      throw new Error("The version changed while its files were hashed.");
    return { snapshot: now, created: false, unknown: 0, mismatchedChunks: 0 };
  }

  if (result.unknown.length > 0) {
    opts.logger?.warn(
      `${result.unknown.length} of ${result.files.length} file(s) no longer match the version's manifest ` +
        `(${result.mismatchedChunks} chunk(s) differ): the folder was changed after it was imported. ` +
        `Their original contents can't be recovered, so they are recorded as unknown and will count as changed.`,
    );
  }
  opts.logger?.info(
    `Recorded hashes of ${result.files.length - result.unknown.length} file(s) as revision ${version.revision}`,
  );

  return {
    snapshot: {
      versionId: target.versionId,
      gameId: target.gameId,
      revision: version.revision,
      files: result.files,
      cache: result.cache,
    },
    created: true,
    unknown: result.unknown.length,
    mismatchedChunks: result.mismatchedChunks,
  };
}
