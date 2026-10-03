/**
 * Database side of version revisions: reading and writing snapshots,
 * committing a new revision together with its manifest, and clearing every
 * cache that holds a version's old manifest or sizes.
 *
 * Imported by the library manager (manifest regeneration), so this module
 * must not import the library manager itself.
 */

import prisma from "../../db/database";
import { logger as serverLogger } from "../../logging";
import gameSizeManager from "../../gamesize";
import { invalidateManifestCache } from "../manifest";
import { castManifest } from "../manifest/utils";
import { invalidateDepotContext } from "../../services/torrential";
import type { Prisma } from "~/prisma/client/client";
import {
  UNKNOWN_SHA256,
  diffRevisionFiles,
  fileSizesFromManifest,
  hasChanges,
  parseRevisionFiles,
  parseStatCache,
  serializeStatCache,
  type FileStatStamp,
  type RevisionChanges,
  type RevisionFile,
  type StatCache,
} from "./diff";
import { sameStamp, snapshotWithStatCache, type HashLogger } from "./hash";

export type StoredSnapshot = {
  versionId: string;
  gameId: string;
  revision: number;
  files: RevisionFile[];
  /** Stat cache: what was last seen on disk for this version. */
  cache: StatCache;
};

/**
 * One stored snapshot. `"earliest"` is the lowest revision kept for the
 * version. Returns null when there is none (not hashed yet, or never existed).
 */
export async function readSnapshot(
  versionId: string,
  which: number | "earliest",
): Promise<StoredSnapshot | null> {
  const row =
    which === "earliest"
      ? await prisma.gameVersionRevision.findFirst({
          where: { versionId },
          orderBy: { revision: "asc" },
        })
      : await prisma.gameVersionRevision.findUnique({
          where: { versionId_revision: { versionId, revision: which } },
        });
  if (!row) return null;
  return {
    versionId: row.versionId,
    gameId: row.gameId,
    revision: row.revision,
    files: parseRevisionFiles(row.files),
    cache: parseStatCache(row.fileStats),
  };
}

/**
 * Writes the snapshot of a version's CURRENT revision (the first one taken for
 * it). Returns false, writing nothing, if the version's revision is no longer
 * `revision` or that snapshot already exists.
 */
export async function writeCurrentSnapshot(args: {
  gameId: string;
  versionId: string;
  revision: number;
  files: RevisionFile[];
  cache: StatCache;
}): Promise<boolean> {
  return await prisma.$transaction(
    async (tx) => {
      const current = await tx.gameVersion.findUnique({
        where: { versionId: args.versionId },
        select: { revision: true },
      });
      if (!current || current.revision !== args.revision) return false;
      const existing = await tx.gameVersionRevision.findUnique({
        where: {
          versionId_revision: {
            versionId: args.versionId,
            revision: args.revision,
          },
        },
        select: { id: true },
      });
      if (existing) return false;
      await tx.gameVersionRevision.create({
        data: {
          versionId: args.versionId,
          gameId: args.gameId,
          revision: args.revision,
          files: args.files as unknown as Prisma.InputJsonValue,
          fileStats: serializeStatCache(
            args.cache,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    },
    { timeout: 60_000 },
  );
}

/**
 * Stores a new manifest and file list as revision `fromRevision + 1`, with its
 * snapshot, in one transaction. Clears the persisted sizes (they are
 * recomputed from the new manifest). Throws if the version was deleted or its
 * revision moved on in the meantime.
 */
export async function commitNewRevision(args: {
  gameId: string;
  versionId: string;
  fromRevision: number;
  /** The manifest as droplet returned it (a JSON string). */
  manifestJson: string;
  fileList: string[];
  files: RevisionFile[];
  cache: StatCache;
}): Promise<number> {
  const next = args.fromRevision + 1;
  await prisma.$transaction(
    async (tx) => {
      const res = await tx.gameVersion.updateMany({
        where: { versionId: args.versionId, revision: args.fromRevision },
        data: {
          dropletManifest: args.manifestJson,
          fileList: args.fileList,
          revision: next,
          installSize: null,
          downloadSize: null,
        },
      });
      if (res.count !== 1) {
        throw new Error(
          "The version was deleted or updated by something else while this ran. Nothing was saved.",
        );
      }
      await tx.gameVersionRevision.create({
        data: {
          versionId: args.versionId,
          gameId: args.gameId,
          revision: next,
          files: args.files as unknown as Prisma.InputJsonValue,
          fileStats: serializeStatCache(
            args.cache,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 60_000 },
  );
  return next;
}

/**
 * Clears everything that still holds a version's old manifest or sizes:
 * the manifest cache, the gamesize caches and persisted size columns (for the
 * whole game, since delta versions include the versions below them), and
 * torrential's download context for this version.
 *
 * A request that read the old row just before the change can put the old
 * manifest back into a cache right after it was cleared, so the clear runs
 * again a few seconds later, in the background, and then recomputes the
 * persisted sizes.
 */
export async function invalidateVersionCaches(
  gameId: string,
  versionId: string,
  logger: HashLogger,
): Promise<void> {
  await clearOnce(gameId, versionId, logger);
  const timer = setTimeout(() => {
    void (async () => {
      const ids = await clearOnce(gameId, versionId, serverLogger);
      for (const id of ids) {
        try {
          await gameSizeManager.getVersionSize(id);
        } catch (e) {
          serverLogger.warn(
            `[REVISIONS] Could not recompute the size of version ${id}: ${e}`,
          );
        }
      }
    })().catch((e) =>
      serverLogger.warn(
        `[REVISIONS] Second cache clear for version ${versionId} failed: ${e}`,
      ),
    );
  }, 5_000);
  timer.unref?.();
}

async function clearOnce(
  gameId: string,
  versionId: string,
  logger: HashLogger,
): Promise<string[]> {
  // Manifest cache first: a size computed in between would otherwise be
  // recomputed from the old cached manifest and persisted again.
  const versions = await prisma.gameVersion.findMany({
    where: { gameId },
    select: { versionId: true },
  });
  const gameVersionIds = versions.map((v) => v.versionId);
  await invalidateManifestCache(
    gameVersionIds.includes(versionId)
      ? gameVersionIds
      : [...gameVersionIds, versionId],
  );
  const ids = await gameSizeManager.invalidateGame(gameId);
  try {
    await invalidateDepotContext(gameId, versionId);
  } catch (e) {
    logger.warn(
      `Could not clear torrential's cached copy of this version (${e}). ` +
        `Downloads already running may keep failing on old chunks until they have been idle for 10 minutes.`,
    );
  }
  return ids;
}

/**
 * Replaces the stat cache of a version's current revision (what "Check for
 * changes" saw on disk), so a publish right after re-reads only files touched
 * since. No-op if the revision moved on meanwhile.
 */
export async function saveStatCache(
  versionId: string,
  revision: number,
  cache: StatCache,
): Promise<void> {
  await prisma.gameVersionRevision.updateMany({
    where: { versionId, revision },
    data: {
      fileStats: serializeStatCache(cache) as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Called by manifest regeneration (achievement scan, GBE backfill,
 * "Regenerate Manifests") after it rebuilt a version's manifest from disk.
 * The caller holds the version lock and passes the stat stamps it took
 * BEFORE droplet read the files.
 *
 * - The version has a snapshot for its current revision: hash the files
 *   (re-reading only those touched since they were last hashed) and check
 *   none changed since before the manifest was generated. If any content
 *   differs, store manifest + file list + snapshot as the next revision in
 *   one transaction, so clients see an update; otherwise store the manifest
 *   and refreshed stat cache under the same revision, also in one
 *   transaction. If hashing fails or a file changed during the
 *   regeneration, NOTHING is stored and false is returned: saving the
 *   manifest without a matching snapshot would leave clients updating into
 *   files that contradict the current revision's hashes.
 * - No snapshot yet: store the manifest as before; "Record fingerprints" or
 *   "Check for changes" hashes the files against this manifest later.
 *
 * Then clears every cache that holds the old manifest.
 */
export async function storeRegeneratedManifest(args: {
  gameId: string;
  versionId: string;
  /** Version folder on disk, or undefined when it can't be resolved. */
  versionDir: string | undefined;
  manifestJson: string;
  fileList: string[];
  /** Stat stamps taken before the manifest was generated. */
  beforeStats: Map<string, FileStatStamp> | null;
  logger: HashLogger;
}): Promise<boolean> {
  const { gameId, versionId, logger } = args;
  const current = await prisma.gameVersion.findUnique({
    where: { versionId },
    select: { revision: true },
  });
  if (!current) {
    logger.warn(`Manifest regen: version ${versionId} no longer exists`);
    return false;
  }

  const snapshot = await readSnapshot(versionId, current.revision);
  if (!snapshot) {
    const res = await prisma.gameVersion.updateMany({
      where: { versionId, revision: current.revision },
      data: {
        dropletManifest: args.manifestJson,
        fileList: args.fileList,
        installSize: null,
        downloadSize: null,
      },
    });
    if (res.count === 0) {
      logger.warn(
        `Manifest regen: version ${versionId} was deleted or updated meanwhile; nothing saved`,
      );
      return false;
    }
    await invalidateVersionCaches(gameId, versionId, logger);
    return true;
  }

  let next: { files: RevisionFile[]; cache: StatCache };
  let changes: RevisionChanges;
  try {
    if (!args.versionDir || !args.beforeStats) {
      throw new Error("the version folder could not be resolved");
    }
    const sizes = fileSizesFromManifest(castManifest(args.manifestJson).chunks);
    const result = await snapshotWithStatCache(
      args.versionDir,
      [...sizes].map(([path, size]) => ({ path, size })),
      snapshot.cache,
      { logger },
    );
    for (const [path, entry] of result.cache) {
      const was = args.beforeStats.get(path);
      if (!was || !sameStamp(was, entry.stamp)) {
        throw new Error(`${path} changed while the manifest was generated`);
      }
    }
    next = { files: result.files, cache: result.cache };
    changes = diffRevisionFiles(snapshot.files, result.files);
  } catch (e) {
    logger.warn(
      `Manifest regen: could not hash the version's files (${e}). Nothing was saved, so the ` +
        `stored manifest and revision ${current.revision} stay as they were. Run it again ` +
        `once nothing is writing to the folder.`,
    );
    return false;
  }

  if (hasChanges(changes)) {
    const revision = await commitNewRevision({
      gameId,
      versionId,
      fromRevision: current.revision,
      manifestJson: args.manifestJson,
      fileList: args.fileList,
      files: next.files,
      cache: next.cache,
    });
    logger.info(
      `Files changed (${changes.totals.addedCount} added, ${changes.totals.changedCount} changed, ` +
        `${changes.totals.removedCount} removed): saved as revision ${revision}`,
    );
  } else {
    // Same content: new manifest (fresh chunk ids) under the same revision,
    // with the refreshed stat cache, as one outcome.
    const saved = await prisma.$transaction(
      async (tx) => {
        const res = await tx.gameVersion.updateMany({
          where: { versionId, revision: current.revision },
          data: {
            dropletManifest: args.manifestJson,
            fileList: args.fileList,
            installSize: null,
            downloadSize: null,
          },
        });
        if (res.count === 0) return false;
        await tx.gameVersionRevision.updateMany({
          where: { versionId, revision: snapshot.revision },
          data: {
            fileStats: serializeStatCache(
              next.cache,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
        return true;
      },
      { timeout: 60_000 },
    );
    if (!saved) {
      logger.warn(
        `Manifest regen: version ${versionId} was deleted or updated meanwhile; nothing saved`,
      );
      return false;
    }
  }

  await invalidateVersionCaches(gameId, versionId, logger);
  return true;
}

/** Number of files in a snapshot whose hash is unknown. */
export function countUnknown(files: RevisionFile[]): number {
  return files.filter((f) => f.sha256 === UNKNOWN_SHA256).length;
}
