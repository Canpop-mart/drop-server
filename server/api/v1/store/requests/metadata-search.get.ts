import aclManager from "~/server/internal/acls";
import metadataHandler from "~/server/internal/metadata";

/**
 * User-facing metadata search for the game-request flow. Same providers
 * as the admin import search at `/api/v1/admin/import/game/search`, just
 * gated on `store:read` so any signed-in user can identify the game
 * they're requesting without admin rights.
 *
 * Provider results are de-duplicated and ranked by fuzzy match against
 * the query inside `metadataHandler.search`. They also flow through the
 * per-provider 1h cache, so a community of users all searching for the
 * same upcoming title doesn't burn through IGDB/Steam API quota.
 *
 * Returns `[]` (not 404) on no matches — the request modal renders an
 * inline empty-state and shouldn't have to interpret an error.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const search = query.q?.toString().trim();
  if (!search || search.length < 2)
    throw createError({
      statusCode: 400,
      statusMessage: "Query must be at least 2 characters.",
    });

  return await metadataHandler.search(search);
});
