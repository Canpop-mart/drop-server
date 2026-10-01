import type { EventHandlerRequest, H3Event } from "h3";
import { parse as getMimeTypeBuffer } from "file-type-mime";
import type { Dump, Pull } from "../objects/transactional";
import { ObjectTransactionalHandler } from "../objects/transactional";
import {
  assertWithinLimit,
  enforceUploadLimit,
  type UploadLimitKey,
} from "../objects/uploadLimits";

/**
 * Multipart form-data parser used by every upload endpoint.
 *
 * The optional `limit` arg ties this into the per-asset-class size
 * caps in `server/internal/objects/uploadLimits.ts`:
 *   - We do a cheap Content-Length pre-check before reading the body.
 *   - After the body is buffered we hard-stop on the actual payload
 *     size, so a missing/lying Content-Length header still gets
 *     rejected. The transaction is dumped so we don't leave half-
 *     created records behind.
 *
 * Endpoints that have no per-class cap (legacy paths) can omit the
 * `limit` arg and behave as before.
 *
 * `acceptMime`, when given, rejects any file whose type sniffed from its
 * bytes (the same sniffing the object store uses to pick the Content-Type it
 * serves) is not in the list. The type the uploader declares is ignored.
 */
export async function handleFileUpload(
  h3: H3Event<EventHandlerRequest>,
  metadata: { [key: string]: string },
  permissions: Array<string>,
  max = -1,
  limit?: UploadLimitKey,
  acceptMime?: readonly string[],
): Promise<[string[], { [key: string]: string }, Pull, Dump] | undefined> {
  if (limit) enforceUploadLimit(h3, limit);

  const formData = await readMultipartFormData(h3);
  if (!formData) return undefined;
  const transactionalHandler = new ObjectTransactionalHandler();
  const [add, pull, dump] = transactionalHandler.new(metadata, permissions);
  const options: { [key: string]: string } = {};
  const ids = [];

  let totalBytes = 0;
  for (const entry of formData) {
    if (entry.filename) {
      if (max > 0 && ids.length >= max) continue;
      totalBytes += entry.data.length;
      if (limit) {
        try {
          assertWithinLimit(totalBytes, limit);
        } catch (e) {
          // Pending objects only exist in memory until pull() is
          // called, but dumping is still good hygiene so the caller
          // doesn't reuse the transaction.
          await dump();
          throw e;
        }
      }
      if (acceptMime) {
        const mime = getMimeTypeBuffer(new Uint8Array(entry.data).buffer)?.mime;
        if (!mime || !acceptMime.includes(mime)) {
          await dump();
          throw createError({
            statusCode: 415,
            statusMessage: `Unsupported file type (${mime ?? "unknown"}).`,
          });
        }
      }
      // Add file to transaction handler so we can void it later if we error out
      ids.push(add(entry.data));
      continue;
    }
    if (!entry.name) continue;

    options[entry.name] = entry.data.toString("utf-8");
  }

  return [ids, options, pull, dump];
}

/** Image types accepted for profile pictures and banners. */
export const PROFILE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
