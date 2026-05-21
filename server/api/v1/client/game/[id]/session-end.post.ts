import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { logger } from "~/server/internal/logging";
import { retroAchievementsProvider } from "~/server/internal/achievements/retroachievements";

/**
 * Called by the game client when a play session ends.
 *
 * Goldberg unlocks are reported separately via `achievements-report`
 * (the client reads the local save file and POSTs them directly). This
 * endpoint only handles the RetroAchievements side: it asks the RA
 * provider to pull the user's progress for this game and record any new
 * unlocks.
 *
 * Unlock recording goes through `unlocksRepo.recordUnlock` inside the
 * provider, which upserts on `(userId, achievementId)` — so a session-end
 * sync can never double-credit an unlock the live `ra-poll` already
 * recorded mid-session.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  try {
    const { newlyUnlocked } = await retroAchievementsProvider.syncUnlocks(
      gameId,
      user.id,
    );
    if (newlyUnlocked > 0) {
      logger.info(
        `[ACH:ra] session-end: synced ${newlyUnlocked} unlock(s) for user=${user.id} game=${gameId}`,
      );
    }
    return { synced: newlyUnlocked };
  } catch (error) {
    logger.error(
      `[ACH:ra] session-end sync error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { synced: 0 };
  }
});
