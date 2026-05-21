import aclManager from "~/server/internal/acls";
import objectHandler from "~/server/internal/objects";
import sanitize from "sanitize-filename";

/**
 * HEAD /api/v1/object/:id
 *
 * Headers-only sibling of GET. Returns the same Cache-Control, ETag,
 * and Content-Length headers a GET would set so a browser can decide
 * whether its cached copy is still valid without downloading bytes.
 *
 * Honours `If-None-Match` against either the id-based ETag (the id
 * itself) or the legacy MD5 hash.
 */
export default defineEventHandler(async (h3) => {
  const unsafeId = getRouterParam(h3, "id");
  if (!unsafeId)
    throw createError({ statusCode: 400, statusMessage: "Invalid ID" });

  const userId = await aclManager.getUserIdACL(h3, ["object:read"]);

  const id = sanitize(unsafeId);

  const ifNoneMatch = h3.headers.get("If-None-Match");
  if (ifNoneMatch) {
    if (ifNoneMatch === id || ifNoneMatch === `"${id}"`) {
      setResponseStatus(h3, 304);
      setHeader(h3, "ETag", `"${id}"`);
      setHeader(h3, "Cache-Control", "private, max-age=31536000, immutable");
      return null;
    }
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
  const stat = await objectHandler.stat(id);
  if (stat) setHeader(h3, "Content-Length", stat.size);
  return null;
});
