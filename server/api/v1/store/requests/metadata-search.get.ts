import aclManager from "~/server/internal/acls";
import metadataHandler from "~/server/internal/metadata";

/**
 * Metadata search for the game-request flow. Same providers as the admin
 * import search at `/api/v1/admin/import/game/search`, gated on `store:read`
 * so any signed-in user can identify the game they're requesting, and used by
 * the admin request triage page too.
 *
 * Provider results are de-duplicated and ranked by fuzzy match against the
 * query inside `metadataHandler.searchDetailed`. They also flow through the
 * per-provider 1h cache.
 *
 * Returns `{ results, failedProviders }`. An empty `results` with an empty
 * `failedProviders` means no provider knows the game; a non-empty
 * `failedProviders` means some providers could not be asked, so the pages
 * can say so instead of showing "no matches". Provider error text is only
 * included for admins: it can carry upstream URLs and is no use to a player.
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

  const isAdmin = await aclManager.allowSystemACL(h3, ["import:game:read"]);
  const { results, failedProviders } =
    await metadataHandler.searchDetailed(search);

  return {
    results,
    failedProviders: failedProviders.map((f) => ({
      source: f.source,
      name: f.name,
      ...(isAdmin ? { error: f.error } : {}),
    })),
  };
});
