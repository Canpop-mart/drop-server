import aclManager from "~/server/internal/acls";
import userLibraryManager from "~/server/internal/userlibrary";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["collections:read"]);
  if (!userId)
    throw createError({
      statusCode: 403,
    });

  // Exclude curated (featured) collections from a user's personal list by
  // default — they live in the store. The admin management page opts back in
  // with ?includeFeatured=true.
  const includeFeatured = getQuery(h3).includeFeatured === "true";
  const collections = await userLibraryManager.fetchCollections(userId, {
    excludeFeatured: !includeFeatured,
  });
  return collections;
});
