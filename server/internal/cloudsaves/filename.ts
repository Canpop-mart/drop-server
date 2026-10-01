import sanitizeFilename from "sanitize-filename";

/** Longest filename a cloud save row may carry, in UTF-8 bytes. */
export const MAX_SAVE_FILENAME_LEN = 255;

/**
 * Whether a client-sent name is too long to store intact. Such a name is
 * refused rather than cut: a truncated name never matches its own row again
 * and comes back down as a different file. The client refuses the same names
 * before sending them (`MAX_CLOUD_FILENAME_BYTES` in its `save_sync/scan.rs`).
 */
export function cloudSaveFilenameTooLong(raw: string): boolean {
  return Buffer.byteLength(String(raw), "utf8") > MAX_SAVE_FILENAME_LEN;
}

/**
 * The name a save is stored under, given the name a client sent.
 *
 * Every endpoint that writes a row or compares a client's name against one
 * must go through this. Upload used to sanitize while sync-check compared the
 * raw name, so a file whose name `sanitize-filename` changes ("Zelda: X.srm"
 * is stored as "Zelda X.srm") never matched its own cloud row: it was
 * re-uploaded on every launch and its cloud copy came back down as a second,
 * stray file.
 *
 * The client escapes every character this would strip (see `escape_relpath`
 * in the client's `save_sync/scan.rs`), so for anything it sends today this is
 * the identity. It still runs here for rows and clients that predate that.
 *
 * Returns "" for a name over {@link MAX_SAVE_FILENAME_LEN} bytes instead of
 * truncating it; callers already refuse an empty name, and see
 * {@link cloudSaveFilenameTooLong} for the clearer message.
 *
 * Pure and untested: drop-server has no test runner.
 */
export function cloudSaveFilename(raw: string): string {
  if (cloudSaveFilenameTooLong(raw)) return "";
  return sanitizeFilename(String(raw));
}
