import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { logger } from "~/server/internal/logging";
import notificationSystem from "~/server/internal/notifications";
import prisma from "~/server/internal/db/database";
import { syncRAUnlocksForUser } from "~/server/internal/achievements/retroachievements";

/**
 * Called by the desktop client during gameplay to poll for newly unlocked
 * RetroAchievements. Reads the player's RA progress, records unlocks the
 * server doesn't have yet (unlocks earned before an achievement reset are
 * ignored), and returns the ones recorded by this call so the client can
 * toast them.
 *
 * Only the player's linked RA username is needed; see syncRAUnlocksForUser
 * for which credentials read the progress. `skipped` says why nothing was
 * read (no_link / no_account / no_credentials / empty_progress) so the
 * client can log it rather than silently getting an empty list.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  try {
    const result = await syncRAUnlocksForUser(gameId, user.id, "ra-poll");
    if (result.skipped) {
      logger.info(
        `[RA-POLL] game=${gameId} user=${user.id}: skipped (${result.skipped})`,
      );
    }

    if (result.unlocked.length > 0) {
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        select: { mName: true },
      });
      for (const a of result.unlocked) {
        await notificationSystem
          .push(user.id, {
            title: a.title,
            description: game?.mName ?? "",
            actions: a.iconUrl ? [a.iconUrl] : [],
            nonce: `achievement-unlock:${gameId}:${a.title}:${Date.now()}`,
            acls: ["user:store:read"],
          })
          .catch((err) => {
            logger.warn(`[ACH:ra] Failed to push notification: ${err}`);
          });
      }
      logger.info(
        `[RA-POLL] ${result.unlocked.length} new achievements for user ${user.id} game ${gameId}: ${result.unlocked.map((a) => a.title).join(", ")}`,
      );
    }

    return {
      newlyUnlocked: result.unlocked,
      skipped: result.skipped ?? null,
    };
  } catch (error) {
    logger.error(
      `[RA-POLL] Error polling RA: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { newlyUnlocked: [], skipped: "error" };
  }
});
