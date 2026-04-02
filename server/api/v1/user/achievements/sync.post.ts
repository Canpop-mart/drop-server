import aclManager from "~/server/internal/acls";

/**
 * Manual achievement sync endpoint.
 * Achievement sync is now handled client-side via Goldberg detection.
 * This endpoint is kept as a no-op for API compatibility.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  return { synced: 0 };
});
