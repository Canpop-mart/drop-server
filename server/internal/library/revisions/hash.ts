/**
 * File hashing for version revisions. Everything streams: a file is never
 * read into memory whole, because a version can be an entire game.
 *
 * Paths are manifest filenames joined onto the version directory. Symlinks
 * are followed, as droplet follows them when it builds the manifest. The
 * containment check in `resolveInside` is lexical only: a symlink inside the
 * version folder that points elsewhere is read through, exactly as droplet
 * reads it for the manifest and torrential serves it to clients.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, type Hash } from "node:crypto";
import {
  UNKNOWN_SHA256,
  diffRevisionFiles,
  fileSizesFromManifest,
  orderChunksForSequentialFiles,
  type FileStatStamp,
  type RevisionChanges,
  type RevisionFile,
  type StatCache,
} from "./diff";
import type { DropletManifest } from "../manifest/utils";

export type HashLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

export interface HashRunOptions {
  signal?: AbortSignal;
  /**
   * Called after every block read with its size in bytes (0 between files).
   * The caller can await a delay here to throttle the read rate.
   */
  pace?: (bytes: number) => Promise<void>;
  /** Fraction done, 0 to 1. */
  onProgress?: (fraction: number) => void;
  logger?: HashLogger;
}

const READ_BLOCK = 1024 * 1024;

export function statStamp(st: fs.Stats): FileStatStamp {
  return [st.mtimeMs, st.ctimeMs];
}

export function sameStamp(a: FileStatStamp, b: FileStatStamp) {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Joins a manifest filename onto the version directory, refusing a name that
 * climbs out of it ("../x", absolute paths). Lexical check only, see the file
 * comment.
 */
export function resolveInside(versionDir: string, rel: string): string {
  const root = path.resolve(versionDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`File path leaves the version folder: ${rel}`);
  }
  return abs;
}

async function statOrUndefined(abs: string): Promise<fs.Stats | undefined> {
  try {
    return await fsp.stat(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw e;
  }
}

/**
 * A read error that means "the file is not what the manifest says" (it got
 * shorter, or vanished, between the stat and the read). Any other read error
 * (EACCES, EIO, ...) is a failure of the whole run, never a reason to record
 * a file as unknown: that would be permanent, while the error may not be.
 */
class ContentChangedError extends Error {}

function isContentChange(e: unknown): boolean {
  if (e instanceof ContentChangedError) return true;
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Streams `length` bytes from `start` into every hash in `sinks`. */
async function readRange(
  abs: string,
  start: number,
  length: number,
  sinks: Hash[],
  opts: HashRunOptions,
  onBytes: (n: number) => void,
): Promise<number> {
  if (length === 0) return 0;
  const stream = fs.createReadStream(abs, {
    start,
    end: start + length - 1,
    highWaterMark: READ_BLOCK,
  });
  let read = 0;
  // Breaking out of for-await (abort, error) destroys the stream.
  for await (const block of stream as AsyncIterable<Buffer>) {
    opts.signal?.throwIfAborted();
    for (const sink of sinks) sink.update(block);
    read += block.length;
    onBytes(block.length);
    if (opts.pace) await opts.pace(block.length);
  }
  return read;
}

/** SHA-256 and byte count of a whole file, streamed. */
export async function hashFile(
  abs: string,
  opts: HashRunOptions = {},
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  const stream = fs.createReadStream(abs, { highWaterMark: READ_BLOCK });
  for await (const block of stream as AsyncIterable<Buffer>) {
    opts.signal?.throwIfAborted();
    hash.update(block);
    size += block.length;
    if (opts.pace) await opts.pace(block.length);
  }
  return { size, sha256: hash.digest("hex") };
}

/**
 * Stat stamps of the given files (relative names), taken before something
 * reads them, to prove afterwards that nothing changed in between.
 */
export async function statFolderFiles(
  versionDir: string,
  rels: string[],
  signal?: AbortSignal,
): Promise<Map<string, FileStatStamp>> {
  const out = new Map<string, FileStatStamp>();
  for (const rel of rels) {
    signal?.throwIfAborted();
    out.set(rel, statStamp(await fsp.stat(resolveInside(versionDir, rel))));
  }
  return out;
}

export type VerifiedSnapshot = {
  files: RevisionFile[];
  /** Stat cache entries for every file whose hash is known. */
  cache: StatCache;
  /** Files recorded with UNKNOWN_SHA256. */
  unknown: string[];
  /** Chunks whose bytes on disk no longer match the manifest checksum. */
  mismatchedChunks: number;
};

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Hashes every file of a version AND checks the bytes against the manifest's
 * per-chunk checksums in the same single read.
 *
 * Used for the first snapshot of a version (import, "Record fingerprints",
 * or the first "Check for changes"). The snapshot must describe what clients actually
 * installed, which is what the manifest describes. A file whose bytes can't be
 * shown to match the manifest (missing, wrong size, in a chunk whose checksum
 * no longer matches, or changed while being read) is recorded with
 * UNKNOWN_SHA256 instead of the hash of whatever is on disk now. Recording
 * today's bytes would claim clients have content they don't, and an update
 * would then skip that file.
 *
 * A read error other than the file changing (permissions, I/O) throws: the
 * caller retries later rather than recording a permanent "unknown".
 *
 * droplet's chunk checksum is SHA-256 over the chunk's file ranges
 * concatenated in the order listed (droplet-rs manifest.rs).
 */
export async function snapshotFromManifest(
  versionDir: string,
  manifest: DropletManifest,
  opts: HashRunOptions = {},
): Promise<VerifiedSnapshot> {
  const chunks = manifest.chunks ?? {};
  const sizes = fileSizesFromManifest(chunks);
  const totalBytes = [...sizes.values()].reduce((a, b) => a + b, 0);

  const absPaths = new Map<string, string>();
  const preStats = new Map<string, FileStatStamp>();
  // Files that cannot be read as the manifest describes them at all.
  const unreadable = new Set<string>();
  for (const [file, size] of sizes) {
    opts.signal?.throwIfAborted();
    let abs: string;
    try {
      abs = resolveInside(versionDir, file);
    } catch (e) {
      opts.logger?.warn(String(e));
      unreadable.add(file);
      continue;
    }
    absPaths.set(file, abs);
    const st = await statOrUndefined(abs);
    if (!st || !st.isFile() || st.size !== size) {
      unreadable.add(file);
      continue;
    }
    preStats.set(file, statStamp(st));
  }

  const { order, stuck } = orderChunksForSequentialFiles(chunks);
  const unknown = new Set<string>(unreadable);
  for (const id of stuck) {
    for (const entry of chunks[id]?.files ?? []) unknown.add(entry.filename);
  }
  if (stuck.length > 0) {
    opts.logger?.warn(
      `${stuck.length} manifest chunk(s) have file ranges out of order; their files are recorded as unknown`,
    );
  }

  // In-progress hashes of files split over several chunks; a file's digest
  // moves to `digests` as soon as its last byte is read, so only the few files
  // currently straddling chunks hold a hash object.
  const fileHashes = new Map<string, Hash>();
  const fed = new Map<string, number>();
  const digests = new Map<string, string>();
  let mismatchedChunks = 0;
  let doneBytes = 0;
  let lastReported = -1;
  const onBytes = (n: number) => {
    doneBytes += n;
    if (!opts.onProgress || totalBytes === 0) return;
    const pct = Math.floor((doneBytes / totalBytes) * 100);
    if (pct !== lastReported) {
      lastReported = pct;
      opts.onProgress(Math.min(1, doneBytes / totalBytes));
    }
  };

  for (const id of order) {
    opts.signal?.throwIfAborted();
    const chunk = chunks[id];
    if (!chunk) continue;
    // A missing or resized file makes the chunk impossible to check, and
    // every file in it unverifiable.
    if (chunk.files.some((e) => unreadable.has(e.filename))) {
      for (const entry of chunk.files) unknown.add(entry.filename);
      mismatchedChunks++;
      continue;
    }
    const chunkHash = createHash("sha256");
    try {
      for (const entry of chunk.files) {
        let fileHash = fileHashes.get(entry.filename);
        if (!fileHash) {
          fileHash = createHash("sha256");
          fileHashes.set(entry.filename, fileHash);
        }
        const got = await readRange(
          absPaths.get(entry.filename)!,
          entry.start,
          entry.length,
          [chunkHash, fileHash],
          opts,
          onBytes,
        );
        if (got !== entry.length) {
          throw new ContentChangedError(
            `short read of ${entry.filename}: ${got} of ${entry.length} bytes`,
          );
        }
        const total = (fed.get(entry.filename) ?? 0) + entry.length;
        fed.set(entry.filename, total);
        if (total === sizes.get(entry.filename)) {
          digests.set(entry.filename, fileHash.digest("hex"));
          fileHashes.delete(entry.filename);
        }
      }
    } catch (e) {
      if (opts.signal?.aborted || !isContentChange(e)) throw e;
      opts.logger?.warn(`Chunk ${id} changed while it was read: ${e}`);
      for (const entry of chunk.files) unknown.add(entry.filename);
      mismatchedChunks++;
      continue;
    }
    if (chunkHash.digest("hex") !== chunk.checksum) {
      for (const entry of chunk.files) unknown.add(entry.filename);
      mismatchedChunks++;
    }
    if (opts.pace) await opts.pace(0);
  }

  const files: RevisionFile[] = [];
  const cache: StatCache = new Map();
  // Sorted by path so snapshots of the same content compare and read alike.
  for (const [file, size] of [...sizes].sort(([a], [b]) => byPath(a, b))) {
    let sha256 = UNKNOWN_SHA256;
    if (!unknown.has(file)) {
      // The bytes were read between these two stats; if the file was touched
      // in between, what was hashed is not trustworthy.
      const st = await statOrUndefined(absPaths.get(file)!);
      const pre = preStats.get(file);
      const digest = digests.get(file);
      if (st && pre && digest && sameStamp(pre, statStamp(st))) {
        sha256 = digest;
        cache.set(file, { stamp: pre, size, sha256 });
      } else {
        unknown.add(file);
      }
    }
    files.push({ path: file, size, sha256 });
  }

  return {
    files,
    cache,
    unknown: [...unknown].filter((f) => sizes.has(f)).sort(byPath),
    mismatchedChunks,
  };
}

/**
 * Hash of one file, from the stat cache when its size and [mtime, ctime] are
 * unchanged since it was last hashed, otherwise read in full. Throws if the
 * file changes while it is read.
 */
async function hashWithCache(
  rel: string,
  abs: string,
  st: fs.Stats,
  cache: StatCache,
  opts: HashRunOptions,
): Promise<{ sha256: string; reused: boolean }> {
  const stamp = statStamp(st);
  const hit = cache.get(rel);
  if (hit && hit.size === st.size && sameStamp(hit.stamp, stamp)) {
    return { sha256: hit.sha256, reused: true };
  }
  const result = await hashFile(abs, opts);
  const after = await fsp.stat(abs);
  if (result.size !== st.size || !sameStamp(stamp, statStamp(after))) {
    throw new Error(
      `${rel} changed while it was being hashed. Try again once nothing is writing to the folder.`,
    );
  }
  return { sha256: result.sha256, reused: false };
}

/**
 * Builds the snapshot of a freshly generated manifest's files, taking hashes
 * from the stat cache for files untouched since they were last hashed and
 * reading the rest.
 *
 * `entries` are the new manifest's files and sizes. A file whose size on disk
 * differs from the manifest, or that changes while it is hashed, throws: the
 * folder is being modified and the result would not match the manifest.
 */
export async function snapshotWithStatCache(
  versionDir: string,
  entries: Array<{ path: string; size: number }>,
  cache: StatCache,
  opts: HashRunOptions = {},
): Promise<{
  files: RevisionFile[];
  cache: StatCache;
  hashed: number;
  reused: number;
}> {
  const files: RevisionFile[] = [];
  const out: StatCache = new Map();
  let hashed = 0;
  let reused = 0;
  let index = 0;
  for (const entry of [...entries].sort((a, b) => byPath(a.path, b.path))) {
    opts.signal?.throwIfAborted();
    index++;
    const abs = resolveInside(versionDir, entry.path);
    const st = await fsp.stat(abs);
    if (!st.isFile() || st.size !== entry.size) {
      throw new Error(
        `${entry.path} changed while publishing (size ${st.size}, manifest ${entry.size}). Try again once nothing is writing to the folder.`,
      );
    }
    const result = await hashWithCache(entry.path, abs, st, cache, opts);
    if (result.reused) reused++;
    else hashed++;
    files.push({ path: entry.path, size: entry.size, sha256: result.sha256 });
    out.set(entry.path, {
      stamp: statStamp(st),
      size: entry.size,
      sha256: result.sha256,
    });
    opts.onProgress?.(index / Math.max(1, entries.length));
    if (opts.pace) await opts.pace(0);
  }
  return { files, cache: out, hashed, reused };
}

/**
 * "Check for changes": what publishing the folder as it is now would change,
 * compared to a revision snapshot. Every file is hashed (or taken from the
 * stat cache), and the returned cache describes the whole folder as seen now,
 * so a publish right after re-reads only files touched since the check.
 *
 * `diskFiles` is the folder's file list as droplet sees it (relative names).
 */
export async function diffFolderAgainstSnapshot(
  versionDir: string,
  diskFiles: string[],
  snapshotFiles: RevisionFile[],
  cache: StatCache,
  opts: HashRunOptions = {},
): Promise<{
  changes: RevisionChanges;
  cache: StatCache;
  hashed: number;
  reused: number;
}> {
  const current: RevisionFile[] = [];
  const out: StatCache = new Map();
  let hashed = 0;
  let reused = 0;
  let index = 0;
  for (const rel of diskFiles) {
    opts.signal?.throwIfAborted();
    index++;
    const abs = resolveInside(versionDir, rel);
    const st = await statOrUndefined(abs);
    // Gone since the listing: leave it out, it shows as removed if it was in
    // the snapshot.
    if (!st || !st.isFile()) continue;
    const result = await hashWithCache(rel, abs, st, cache, opts);
    if (result.reused) reused++;
    else hashed++;
    current.push({ path: rel, size: st.size, sha256: result.sha256 });
    out.set(rel, {
      stamp: statStamp(st),
      size: st.size,
      sha256: result.sha256,
    });
    opts.onProgress?.(index / Math.max(1, diskFiles.length));
    if (opts.pace) await opts.pace(0);
  }
  return {
    changes: diffRevisionFiles(snapshotFiles, current),
    cache: out,
    hashed,
    reused,
  };
}
