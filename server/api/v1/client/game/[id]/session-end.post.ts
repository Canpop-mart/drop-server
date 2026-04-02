import { defineClientEventHandler } from "~/server/internal/clients/event-handler";

/**
 * Called by the game client when a play session ends.
 * Achievement sync is handled client-side via the achievements-report endpoint
 * (Goldberg reads local save files and reports them directly).
 */
export default defineClientEventHandler(async (h3) => {
  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  return { synced: 0 };
});
