/**
 * Backend interface for the object store. `objectHandler` only talks to this
 * interface — `fs.*`, S3 SDKs, GCS clients, etc. live behind concrete
 * implementations and never leak into the public API.
 *
 * Why this exists
 * ───────────────
 * Pre-2026, the only backend was `FsObjectBackend` and its base class
 * `ObjectBackend` lived inside `objectHandler.ts`. Adding a second backend
 * (S3, GCS, …) meant either re-opening that file or relying on the implicit
 * shape. This file formalises the contract so:
 *   - new backends are a single sibling file (see `s3Backend.ts` for the
 *     stub),
 *   - callers can grep for one interface name to learn what every backend
 *     must implement,
 *   - the GC task, admin browser, and transactional helper get a stable
 *     surface (e.g. `stat()`, `read()`) instead of opening `fs` themselves.
 *
 * The "old-shape" methods on the legacy `ObjectBackend` abstract class are
 * kept on the implementation for back-compat (write, startWriteStream,
 * fetchHash, cleanupMetadata, etc.) — they're not part of the new minimal
 * interface but the existing `ObjectHandler` still calls them. As long as a
 * new backend implements both the new `ObjectStorageBackend` interface and
 * extends the legacy `ObjectBackend` shape from `./objectHandler`, the rest
 * of the code keeps working.
 */
import type { Readable } from "stream";

export type ObjectId = string;

export type ObjectStat = {
  /** Size in bytes. */
  size: number;
  /** Last modification time. For content-hash IDs this is also the
   * creation time. */
  mtime: Date;
};

/**
 * Minimal storage-only interface. Permission checks, mime sniffing, and
 * hash bookkeeping live in `ObjectHandler` on top of this.
 */
export interface ObjectStorageBackend {
  /** Cheap existence check — must not download the object. */
  exists(id: ObjectId): Promise<boolean>;
  /** Open a readable stream of the object payload. Returns undefined if
   * the object does not exist. */
  read(id: ObjectId): Promise<Readable | undefined>;
  /** Persist the payload. Streams are consumed; Buffers are written in
   * one shot. Returns false on failure. */
  write(id: ObjectId, source: Readable | Buffer): Promise<boolean>;
  /** Remove the payload. Idempotent — deleting a non-existent object
   * returns true. */
  delete(id: ObjectId): Promise<boolean>;
  /** Filesystem-style stat. Returns undefined if the object is missing. */
  stat(id: ObjectId): Promise<ObjectStat | undefined>;
}
