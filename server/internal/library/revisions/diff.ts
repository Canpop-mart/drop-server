/**
 * Pure helpers for version revisions (in-place updates). No I/O, no database.
 *
 * drop-server has no test runner, so nothing here is covered by tests in the
 * repo; keep it pure so it can be checked by hand or lifted into a test later.
 */

/** One file of a revision snapshot. Exactly the shape clients receive. */
export type RevisionFile = {
  /**
   * Relative to the version root: exactly the manifest's filename for the
   * file. droplet builds those with the host OS separator, so a library on a
   * Windows-hosted server has backslashes here; clients normalise.
   */
  path: string;
  size: number;
  /** Lowercase hex SHA-256 of the whole file, or UNKNOWN_SHA256. */
  sha256: string;
};

/**
 * The hash of a file whose content at that revision could not be established:
 * the first snapshot of a version was taken after its folder had already been
 * edited, so the bytes clients installed are gone. It never equals a real
 * hash, so clients and the diff below treat the file as changed.
 */
export const UNKNOWN_SHA256 = "";

/** [mtimeMs, ctimeMs] of a file when it was hashed. Server-only. */
export type FileStatStamp = [number, number];

/**
 * What the server last saw of one file on disk: its stat stamp and size when
 * it was hashed, and the hash. Server-only, never sent to clients. A file
 * whose stamp and size still match is not read again.
 */
export type StatCacheEntry = {
  stamp: FileStatStamp;
  size: number;
  sha256: string;
};
export type StatCache = Map<string, StatCacheEntry>;

export type FileChange = {
  path: string;
  size: number;
  /**
   * Set by "Check for changes" on files that publish's emulator setup may
   * write again (steam_api DLLs, their backups, steam_settings/), so the
   * dry-run entry may not survive the publish.
   */
  emulatorSetup?: boolean;
};

const STEAM_API_NAMES = new Set([
  "steam_api64.dll",
  "steam_api.dll",
  "libsteam_api.so",
]);

/**
 * True for a path that the import's emulator setup (GBE swap, goldberg.ts
 * setupGoldberg) may create, replace or delete: a steam_api library, its
 * .steam_backup / .sse_backup copy, or anything inside a steam_settings
 * folder. Accepts "/" and "\\" separators.
 */
export function isEmulatorSetupPath(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/);
  const name = parts[parts.length - 1] ?? "";
  if (parts.slice(0, -1).includes("steam_settings")) return true;
  if (STEAM_API_NAMES.has(name)) return true;
  const base = name.replace(/\.(steam|sse)_backup$/, "");
  return base !== name && STEAM_API_NAMES.has(base);
}

export type RevisionChanges = {
  added: FileChange[];
  changed: FileChange[];
  removed: FileChange[];
  totals: {
    addedCount: number;
    addedBytes: number;
    changedCount: number;
    changedBytes: number;
    removedCount: number;
    removedBytes: number;
  };
};

const byPath = (a: FileChange, b: FileChange) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * File-by-file difference from `base` to `next`.
 *
 * - added: in next, not in base (size from next)
 * - removed: in base, not in next (size from base)
 * - changed: in both, and the size or hash differs, or either hash is
 *   UNKNOWN_SHA256 (size from next)
 *
 * Lists are sorted by path. Duplicate paths keep the last entry.
 */
export function diffRevisionFiles(
  base: RevisionFile[],
  next: RevisionFile[],
): RevisionChanges {
  const baseMap = new Map(base.map((f) => [f.path, f]));
  const nextMap = new Map(next.map((f) => [f.path, f]));

  const added: FileChange[] = [];
  const changed: FileChange[] = [];
  const removed: FileChange[] = [];

  for (const [path, file] of nextMap) {
    const old = baseMap.get(path);
    if (!old) {
      added.push({ path, size: file.size });
      continue;
    }
    if (
      old.size !== file.size ||
      old.sha256 === UNKNOWN_SHA256 ||
      file.sha256 === UNKNOWN_SHA256 ||
      old.sha256 !== file.sha256
    ) {
      changed.push({ path, size: file.size });
    }
  }
  for (const [path, file] of baseMap) {
    if (!nextMap.has(path)) removed.push({ path, size: file.size });
  }

  added.sort(byPath);
  changed.sort(byPath);
  removed.sort(byPath);

  const sum = (list: FileChange[]) => list.reduce((a, f) => a + f.size, 0);
  return {
    added,
    changed,
    removed,
    totals: {
      addedCount: added.length,
      addedBytes: sum(added),
      changedCount: changed.length,
      changedBytes: sum(changed),
      removedCount: removed.length,
      removedBytes: sum(removed),
    },
  };
}

export function hasChanges(changes: RevisionChanges): boolean {
  return (
    changes.added.length > 0 ||
    changes.changed.length > 0 ||
    changes.removed.length > 0
  );
}

/**
 * Validates a snapshot read back from the database. Throws on anything that
 * is not an array of { path: string, size: number, sha256: string }.
 */
export function parseRevisionFiles(raw: unknown): RevisionFile[] {
  if (!Array.isArray(raw)) throw new Error("Revision files is not an array");
  return raw.map((entry, i) => {
    const e = entry as Partial<RevisionFile> | null;
    if (
      !e ||
      typeof e.path !== "string" ||
      typeof e.size !== "number" ||
      typeof e.sha256 !== "string"
    ) {
      throw new Error(`Revision file entry ${i} is malformed`);
    }
    return { path: e.path, size: e.size, sha256: e.sha256 };
  });
}

/**
 * Stat cache as stored in GameVersionRevision.fileStats:
 * { [path]: [mtimeMs, ctimeMs, size, sha256] }. Malformed entries are dropped
 * (they only cost a re-hash).
 */
export function parseStatCache(raw: unknown): StatCache {
  const out: StatCache = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      typeof value[2] === "number" &&
      typeof value[3] === "string" &&
      value[3] !== UNKNOWN_SHA256
    ) {
      out.set(path, {
        stamp: [value[0], value[1]],
        size: value[2],
        sha256: value[3],
      });
    }
  }
  return out;
}

export function serializeStatCache(
  cache: StatCache,
): Record<string, [number, number, number, string]> {
  const out: Record<string, [number, number, number, string]> = {};
  for (const [path, e] of cache) {
    out[path] = [e.stamp[0], e.stamp[1], e.size, e.sha256];
  }
  return out;
}

/** The parts of a droplet manifest the helpers below read. */
export type ManifestChunks = {
  [chunkId: string]: {
    files: Array<{ filename: string; start: number; length: number }>;
  };
};

/** filename -> total bytes declared for it across all chunks. */
export function fileSizesFromManifest(
  chunks: ManifestChunks,
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const chunk of Object.values(chunks)) {
    for (const entry of chunk.files) {
      sizes.set(
        entry.filename,
        (sizes.get(entry.filename) ?? 0) + entry.length,
      );
    }
  }
  return sizes;
}

/**
 * Orders a manifest's chunks so every file's byte ranges come up in order,
 * starting at 0 and each one beginning where the previous one ended. Reading
 * chunks in this order lets one pass compute both each chunk's checksum and
 * each whole file's hash (a large file is split over several chunks, and a
 * chunk can hold the tail of one file and the start of another).
 *
 * droplet builds chunks in exactly such an order, but stores them in a map,
 * so the order has to be recovered. `stuck` lists chunks that can never be
 * reached (a range that does not start where the previous one ended); callers
 * must treat every file in them as unverifiable.
 */
export function orderChunksForSequentialFiles(chunks: ManifestChunks): {
  order: string[];
  stuck: string[];
} {
  const offsets = new Map<string, number>();
  // "filename\0start" -> chunk ids whose range for that file starts there
  const byStart = new Map<string, string[]>();
  for (const [id, chunk] of Object.entries(chunks)) {
    for (const entry of chunk.files) {
      const key = `${entry.filename}\0${entry.start}`;
      const list = byStart.get(key);
      if (list) list.push(id);
      else byStart.set(key, [id]);
    }
  }

  const filesOf = (id: string) => chunks[id]?.files ?? [];

  const isReady = (id: string) => {
    const local = new Map<string, number>();
    for (const entry of filesOf(id)) {
      const cur = local.get(entry.filename) ?? offsets.get(entry.filename) ?? 0;
      if (entry.start !== cur) return false;
      local.set(entry.filename, cur + entry.length);
    }
    return true;
  };

  const done = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  for (const id of Object.keys(chunks)) {
    if (isReady(id)) {
      queue.push(id);
      queued.add(id);
    }
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    // A chunk queued earlier can stop being ready only if another chunk
    // claimed the same range first, which droplet never produces. Re-check
    // anyway rather than hash ranges out of order.
    if (!isReady(id)) {
      queued.delete(id);
      continue;
    }
    for (const entry of filesOf(id)) {
      offsets.set(
        entry.filename,
        (offsets.get(entry.filename) ?? 0) + entry.length,
      );
    }
    done.add(id);
    order.push(id);
    for (const entry of filesOf(id)) {
      const nextKey = `${entry.filename}\0${offsets.get(entry.filename)}`;
      for (const candidate of byStart.get(nextKey) ?? []) {
        if (done.has(candidate) || queued.has(candidate)) continue;
        if (isReady(candidate)) {
          queue.push(candidate);
          queued.add(candidate);
        }
      }
    }
  }

  const stuck = Object.keys(chunks).filter((id) => !done.has(id));
  return { order, stuck };
}
