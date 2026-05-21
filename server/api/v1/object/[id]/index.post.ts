import aclManager from "~/server/internal/acls";
import objectHandler from "~/server/internal/objects";
import sanitize from "sanitize-filename";
import {
  assertWithinLimit,
  enforceUploadLimit,
} from "~/server/internal/objects/uploadLimits";

/**
 * POST /api/v1/object/:id
 *
 * Direct overwrite of an existing object's payload. Caller already
 * has the ACL string baked into the object (`writeWithPermissions`
 * enforces it). We add a generic size guard at the HTTP layer so an
 * authenticated user can't write a 5GB blob just because the per-
 * column ACL permits writes.
 *
 * Specific upload routes (avatar / banner / game image / …) have
 * tighter per-class caps via `handleFileUpload`. This route is the
 * generic fallback — `rawObject` is the broadest allowed.
 */
export default defineEventHandler(async (h3) => {
  const unsafeId = getRouterParam(h3, "id");
  if (!unsafeId)
    throw createError({ statusCode: 400, statusMessage: "Invalid ID" });

  // Cheap Content-Length pre-check; rejected uploads never get past
  // the headers and so don't consume bandwidth.
  enforceUploadLimit(h3, "rawObject");

  const body = await readRawBody(h3, "binary");
  if (!body)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid upload",
    });

  // Hard post-buffer check — survives a missing/lying Content-Length.
  assertWithinLimit(body.length, "rawObject");

  const userId = await aclManager.getUserIdACL(h3, ["object:update"]);
  const buffer = Buffer.from(body);

  const id = sanitize(unsafeId);
  const result = await objectHandler.writeWithPermissions(
    id,
    async () => buffer,
    userId,
  );
  return { success: result };
});
