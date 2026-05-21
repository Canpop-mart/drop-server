import aclManager from "~/server/internal/acls";
import objectHandler from "~/server/internal/objects";
import sanitize from "sanitize-filename";

/**
 * GET /api/v1/object/:id
 *
 * Streams object payload to the client. Objects are immutable by
 * contract (mutating one creates a new id), so we set the strongest
 * possible cache headers and short-circuit on `If-None-Match`.
 *
 * Cache strategy
 * ──────────────
 * - `Cache-Control: private, max-age=31536000, immutable` — `immutable`
 *   tells the browser to skip revalidation entirely until the cache
 *   entry expires (a year). We stay `private` rather than `public`
 *   because some objects (avatars uploaded as `userId:read`) are
 *   user-scoped and shouldn't be cached by intermediate proxies.
 * - `ETag` — defaults to the object id, since ids are unique per
 *   content. We fall back to the legacy MD5 hash if the backend
 *   already computed one (so existing clients comparing against the
 *   old hash keep getting 304s during the rollout).
 *
 * Conditional GET
 * ───────────────
 * Honours `If-None-Match` against either the new id-based ETag or the
 * legacy hash. Returns 304 with no body, no Content-Type — per RFC.
 *
 * Range support is deferred. Images and small uploads don't benefit
 * and Drop has no audio/video endpoints today. Add `Accept-Ranges`
 * handling here when that changes.
 */
export default defineEventHandler(async (h3) => {
  const unsafeId = getRouterParam(h3, "id");
  if (!unsafeId)
    throw createError({ statusCode: 400, statusMessage: "Invalid ID" });

  const userId = await aclManager.getUserIdACL(h3, ["object:read"]);

  const id = sanitize(unsafeId);

  // Pull metadata first so we can short-circuit on a 304 without
  // opening the payload stream — important for hot caches where most
  // requests are conditional.
  const ifNoneMatch = h3.headers.get("If-None-Match");
  if (ifNoneMatch) {
    // The id itself is an ETag (immutable). Cheap path with no IO.
    if (ifNoneMatch === id || ifNoneMatch === `"${id}"`) {
      setResponseStatus(h3, 304);
      setHeader(h3, "ETag", `"${id}"`);
      setHeader(h3, "Cache-Control", "private, max-age=31536000, immutable");
      return null;
    }
    // Legacy hash path — kept so already-cached clients keep getting
    // 304s while the cache rotates over to id-based ETags.
    const legacyHash = await objectHandler.fetchHash(id);
    if (legacyHash && ifNoneMatch === legacyHash) {
      setResponseStatus(h3, 304);
      setHeader(h3, "ETag", `"${id}"`);
      setHeader(h3, "Cache-Control", "private, max-age=31536000, immutable");
      return null;
    }
  }

  const object = await objectHandler.fetchWithPermissions(id, userId);
  if (!object)
    throw createError({ statusCode: 404, statusMessage: "Object not found" });

  setHeader(h3, "ETag", `"${id}"`);
  setHeader(h3, "Content-Type", object.mime);
  setHeader(h3, "Cache-Control", "private, max-age=31536000, immutable");

  // Best-effort Content-Length so the browser can show a progress bar
  // on slower banners / screenshots. We only know the size on backends
  // that implement stat(), so we skip the header if it's missing
  // rather than streaming an incorrect value.
  const stat = await objectHandler.stat(id);
  if (stat) setHeader(h3, "Content-Length", stat.size);

  // `object.data` is already a Readable stream from the backend (or a
  // Buffer for in-memory sources); h3 happily pipes either.
  return object.data;
});
