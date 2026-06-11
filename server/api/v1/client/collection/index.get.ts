import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import userLibraryManager from "~/server/internal/userlibrary";

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  // The desktop library shows only personal shelves; curated (featured)
  // collections belong to the store, not the user's library.
  const collections = await userLibraryManager.fetchCollections(user.id, {
    excludeFeatured: true,
  });
  return collections;
});
