import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import objectHandler from "~/server/internal/objects";
import sanitize from "sanitize-filename";

/**
 * Client-protocol object fetch. Mirror of the public GET endpoint but
 * authenticated via the client envelope (`utils.fetchUser`) rather
 * than ACL token.
 *
 * Sets the same long-lived immutable cache headers and 304 short-
 * circuit so the Tauri shell's HTTP cache can avoid repeated
 * downloads of the same banners / covers.
 */
export default defineClientEventHandler(async (h3, utils) => {
  const unsafeId = getRouterParam(h3, "id");
  if (!unsafeId)
    throw createError({ statusCode: 400, statusMessage: "Invalid ID" });
  const id = sanitize(unsafeId);

  const user = await utils.fetchUser();

  const ifNoneMatch = h3.headers.get("If-None-Match");
  if (ifNoneMatch) {
    if (ifNoneMatch === id || ifNoneMatch === `"${id}"`) {
      setResponseStatus(h3, 304);
      setHeader(h3, "ETag", `"${id}"`);
      setHeader(
        h3,
        "Cache-Control",
        "private, max-age=31536000, immutable",
      );
      return null;
    }
    const legacyHash = await objectHandler.fetchHash(id);
    if (legacyHash && ifNoneMatch === legacyHash) {
      setResponseStatus(h3, 304);
      setHeader(h3, "ETag", `"${id}"`);
      setHeader(
        h3,
        "Cache-Control",
        "private, max-age=31536000, immutable",
      );
      return null;
    }
  }

  const object = await objectHandler.fetchWithPermissions(id, user.id);
  if (!object)
    throw createError({ statusCode: 404, statusMessage: "Object not found" });

  setHeader(h3, "ETag", `"${id}"`);
  setHeader(h3, "Content-Type", object.mime);
  setHeader(
    h3,
    "Cache-Control",
    "private, max-age=31536000, immutable",
  );
  const stat = await objectHandler.stat(id);
  if (stat) setHeader(h3, "Content-Length", stat.size);
  return object.data;
});
