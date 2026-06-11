import aclManager from "~/server/internal/acls";
import userLibraryManager from "~/server/internal/userlibrary";

/**
 * Add an entire public (store) collection to the requesting user's library:
 *   1. every game in the collection is added to their core library, and
 *   2. a personal copy of the collection is saved as a shelf.
 *
 * Only `isPublic` collections can be imported — that's what makes a collection
 * a store-facing one. Curated/featured collections are public by definition.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, [
    "collections:new",
    "collections:add",
  ]);
  if (!userId)
    throw createError({
      statusCode: 403,
    });

  const collectionId = getRouterParam(h3, "id");
  if (!collectionId)
    throw createError({
      statusCode: 400,
      statusMessage: "ID required in route params",
    });

  const collection = await userLibraryManager.fetchCollection(collectionId);
  if (!collection || !collection.isPublic)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });

  const gameIds = collection.entries.map((e) => e.gameId);

  // 1. Add every game to the user's core library.
  for (const gameId of gameIds) {
    await userLibraryManager.libraryAdd(gameId, userId);
  }

  // 2. Save a personal copy of the collection as a shelf so the user keeps it
  //    grouped (a separate, user-owned collection — not the curated original).
  const shelf = await userLibraryManager.collectionCreate(
    collection.name,
    userId,
  );
  for (const gameId of gameIds) {
    await userLibraryManager.collectionAdd(gameId, shelf.id, userId);
  }

  return { shelfId: shelf.id, gameCount: gameIds.length };
});
