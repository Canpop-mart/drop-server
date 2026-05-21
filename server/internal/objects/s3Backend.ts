/**
 * S3-compatible storage backend — STUB.
 *
 * Why this file exists
 * ────────────────────
 * Part of the 2026 object-store audit (see docs/audit/objects-2026.md). The
 * goal isn't to ship S3 today, it's to prove the new
 * `server/internal/objects/backend.ts` interface is actually
 * backend-agnostic by writing a parallel sibling. A future PR can fill in
 * the AWS SDK calls without touching `objectHandler`, the HTTP endpoints,
 * the GC task, or the admin browser.
 *
 * Implementation notes for whoever wires this up:
 *   - Bucket / region / endpoint should come from env (`S3_BUCKET`,
 *     `AWS_REGION`, `S3_ENDPOINT` for MinIO compat).
 *   - `read()` should stream via `GetObjectCommand` + body.transformToWebStream
 *     → `Readable.fromWeb`. Do NOT buffer.
 *   - `write()` should multipart-upload for streams (`@aws-sdk/lib-storage`'s
 *     Upload class handles this). For Buffers, single `PutObjectCommand` is
 *     fine.
 *   - `delete()` should be idempotent — S3 returns 204 even for missing
 *     keys, so just propagate.
 *   - `stat()` is `HeadObjectCommand`. Map ContentLength → size,
 *     LastModified → mtime.
 *   - Mime + hash caching should stay in `ObjectHandler` /
 *     `FsHashStore` so multiple backends share the same metadata cache.
 *     If S3 ever uses content-addressed IDs the hash is redundant.
 */
import type { Readable } from "stream";
import type {
  ObjectId,
  ObjectStat,
  ObjectStorageBackend,
} from "./backend";

export class S3ObjectBackend implements ObjectStorageBackend {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exists(_id: ObjectId): Promise<boolean> {
    throw new Error("[s3Backend] not yet implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async read(_id: ObjectId): Promise<Readable | undefined> {
    throw new Error("[s3Backend] not yet implemented");
  }

  async write(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _id: ObjectId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _source: Readable | Buffer,
  ): Promise<boolean> {
    throw new Error("[s3Backend] not yet implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async delete(_id: ObjectId): Promise<boolean> {
    throw new Error("[s3Backend] not yet implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async stat(_id: ObjectId): Promise<ObjectStat | undefined> {
    throw new Error("[s3Backend] not yet implemented");
  }
}
