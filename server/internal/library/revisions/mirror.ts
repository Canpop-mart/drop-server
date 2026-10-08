/**
 * Mirrored folders of a version: folders whose contents players' installs
 * are made to match exactly when they update (see GameVersion.mirrorFolders).
 * The client lists any other file it finds there for the player to keep or
 * remove.
 *
 * Pure, no I/O and no server imports: the admin version editor imports this
 * module too. drop-server has no test runner, so nothing here is covered by
 * tests in the repo.
 */

export type MirrorFolderProblem =
  | "empty"
  | "dot"
  | "trailing"
  | "absolute"
  | "drive"
  | "reserved"
  | "invalid"
  | "tooLong"
  | "tooMany";

export type MirrorFolderError = {
  /** The entry as it was given ("" for tooMany, which is about the list). */
  entry: string;
  problem: MirrorFolderProblem;
};

/** Most entries one version may have. */
export const MIRROR_FOLDERS_MAX = 64;
/** Longest entry, in UTF-16 code units, as given (before normalizing). */
export const MIRROR_FOLDER_MAX_LENGTH = 512;

/**
 * Install-root names Drop's client owns (RESERVED_TOP_LEVEL in the client's
 * downloads/update/plan.rs). The client compares them ASCII
 * case-insensitively and never plans a path under one, so a mirrored folder
 * there would do nothing.
 */
const RESERVED_TOP_LEVEL = [
  ".drop-update",
  ".drop-removed",
  ".drop-baseline.json",
  ".dropdata",
  ".mods",
];

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export type MirrorFolderDrop = {
  /** The normalized entry that was left out. */
  entry: string;
  /** The kept entry that already covers it (the same folder or a parent). */
  coveredBy: string;
};

export type NormalizedMirrorFolders =
  | { ok: true; folders: string[]; dropped: MirrorFolderDrop[] }
  | { ok: false; error: MirrorFolderError };

/**
 * Normalizes one entry, or says why it can't be used.
 *
 * Trims it, turns "\" into "/", collapses repeated "/" and strips trailing
 * "/". A leading "/" (or "\") is rejected as an absolute path rather than
 * stripped, so a full server path is never quietly read as a relative one.
 *
 * Also rejects what the client would refuse or misread: a drive letter or a
 * first part ending in ":", a first part that is one of Drop's own names,
 * and any part ending in "." or a space (Windows drops those, so the client
 * would reach the folder under a different name).
 */
export function normalizeMirrorFolder(
  raw: string,
): { ok: true; folder: string } | { ok: false; problem: MirrorFolderProblem } {
  if (raw.length > MIRROR_FOLDER_MAX_LENGTH)
    return { ok: false, problem: "tooLong" };
  const path = raw.trim().replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(path)) return { ok: false, problem: "drive" };
  if (path.startsWith("/")) return { ok: false, problem: "absolute" };

  const folder = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (folder === "") return { ok: false, problem: "empty" };
  if (folder.includes("\0")) return { ok: false, problem: "invalid" };
  const parts = folder.split("/");
  if (parts.some((part) => part === "." || part === ".."))
    return { ok: false, problem: "dot" };
  if (parts.some((part) => part.endsWith(".") || part.endsWith(" ")))
    return { ok: false, problem: "trailing" };
  const first = parts[0] ?? "";
  if (first.endsWith(":")) return { ok: false, problem: "drive" };
  if (RESERVED_TOP_LEVEL.includes(asciiLower(first)))
    return { ok: false, problem: "reserved" };
  return { ok: true, folder };
}

/**
 * Normalizes a whole list of mirrored folders (see normalizeMirrorFolder).
 * More than MIRROR_FOLDERS_MAX entries, or the first bad entry, fails the
 * whole list.
 *
 * `knownFolders` (the version's folders, from foldersFromFileList) fixes
 * case: an entry that matches none of them exactly but exactly one of them
 * case-insensitively takes that folder's spelling, so a client on a
 * case-sensitive disk mirrors the real folder. Anything else stays as typed.
 *
 * Then dedupes case-insensitively, keeping the first spelling, and leaves out
 * every entry that sits inside another entry: "a/b" covers "a/b/c" whichever
 * comes first. The kept entries stay in the order given.
 */
export function normalizeMirrorFolders(
  entries: readonly string[],
  knownFolders: readonly string[] = [],
): NormalizedMirrorFolders {
  if (entries.length > MIRROR_FOLDERS_MAX)
    return { ok: false, error: { entry: "", problem: "tooMany" } };

  const known = new Set(knownFolders);
  const knownByLower = new Map<string, string[]>();
  for (const folder of knownFolders) {
    const key = folder.toLowerCase();
    const list = knownByLower.get(key);
    if (list) list.push(folder);
    else knownByLower.set(key, [folder]);
  }

  const normalized: string[] = [];
  for (const entry of entries) {
    const result = normalizeMirrorFolder(entry);
    if (!result.ok)
      return { ok: false, error: { entry, problem: result.problem } };
    let folder = result.folder;
    if (!known.has(folder)) {
      const matches = knownByLower.get(folder.toLowerCase());
      if (matches?.length === 1 && matches[0]) folder = matches[0];
    }
    normalized.push(folder);
  }

  const items = normalized.map((folder, index) => ({
    folder,
    lower: folder.toLowerCase(),
    index,
  }));
  const folders: string[] = [];
  const dropped: MirrorFolderDrop[] = [];
  for (const me of items) {
    // What covers this entry: an earlier entry with the same name, or any
    // entry that is a parent. The shortest one (earliest among equals) is
    // itself kept, so coveredBy always names a kept entry.
    let cover: (typeof items)[number] | undefined;
    for (const other of items) {
      if (other.index === me.index) continue;
      const covers =
        (other.lower === me.lower && other.index < me.index) ||
        me.lower.startsWith(`${other.lower}/`);
      if (!covers) continue;
      if (
        !cover ||
        other.lower.length < cover.lower.length ||
        (other.lower.length === cover.lower.length && other.index < cover.index)
      )
        cover = other;
    }
    if (cover) dropped.push({ entry: me.folder, coveredBy: cover.folder });
    else folders.push(me.folder);
  }
  return { ok: true, folders, dropped };
}

/** English text for a rejected entry, for API errors. */
export function describeMirrorFolderError(error: MirrorFolderError): string {
  const entry = JSON.stringify(error.entry);
  switch (error.problem) {
    case "empty":
      return `Mirrored folder ${entry} is empty.`;
    case "dot":
      return `Mirrored folder ${entry} must not contain "." or ".." parts.`;
    case "trailing":
      return `Mirrored folder ${entry} has a part ending in "." or a space, which Windows does not keep.`;
    case "absolute":
      return `Mirrored folder ${entry} must be relative to the version folder, without a leading slash.`;
    case "drive":
      return `Mirrored folder ${entry} must be relative to the version folder, without a drive letter or a first part ending in ":".`;
    case "reserved":
      return `Mirrored folder ${entry} starts with a name Drop keeps for its own files.`;
    case "invalid":
      return `Mirrored folder ${entry} contains a NUL character.`;
    case "tooLong":
      return `A mirrored folder is longer than ${MIRROR_FOLDER_MAX_LENGTH} characters.`;
    case "tooMany":
      return `A version can have at most ${MIRROR_FOLDERS_MAX} mirrored folders.`;
  }
}

/**
 * Every folder that contains at least one file of `fileList` (a version's
 * stored file list), directly or further down, with "/" separators, sorted.
 * Suggestions for the admin editor.
 */
export function foldersFromFileList(fileList: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const file of fileList) {
    const parts = file.replace(/\\/g, "/").split("/").filter(Boolean);
    for (let n = 1; n < parts.length; n++) {
      folders.add(parts.slice(0, n).join("/"));
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}
