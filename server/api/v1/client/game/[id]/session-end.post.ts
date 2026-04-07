import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { createRAClient } from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

/**
 * Called by the game client when a play session ends.
 * Achievement sync is handled client-side via the achievements-report endpoint
 * (Goldberg reads local save files and reports them directly).
 *
 * This endpoint handles RetroAchievements syncing:
 * - Checks if game has a RA link
 * - Checks if user has a RA account linked
 * - Fetches recent unlocks from RA
 * - Creates UserAchievement records for newly unlocked achievements
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  let syncedCount = 0;

  try {
    // Get admin RA credentials
    const adminUsername = process.env.RA_USERNAME ?? "";
    const adminApiKey = process.env.RA_API_KEY ?? "";

    if (!adminUsername || !adminApiKey) {
      logger.warn("[RA Sync] RA_USERNAME or RA_API_KEY not configured");
      return { synced: 0 };
    }

    // Check if game has a RA link
    const raLink = await prisma.gameExternalLink.findUnique({
      where: {
        gameId_provider: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });

    if (!raLink) {
      return { synced: 0 };
    }

    // Check if user has a linked RA account
    const userRaAccount = await prisma.userExternalAccount.findUnique({
      where: {
        userId_provider: {
          userId: user.id,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });

    if (!userRaAccount) {
      return { synced: 0 };
    }

    const raClient = createRAClient(adminUsername, adminApiKey);

    // Fetch user's progress for this game
    const raGameId = parseInt(raLink.externalGameId, 10);
    const userProgress = await raClient.getUserGameProgress(
      userRaAccount.externalId,
      userRaAccount.token,
      raGameId,
    );

    if (!userProgress || !userProgress.Achievements) {
      return { synced: 0 };
    }

    // Get all achievements for this game (RA provider only)
    const achievements = await prisma.achievement.findMany({
      where: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    });

    // Build a map of externalId -> achievement
    const achievementMap = new Map(achievements.map((a) => [a.externalId, a]));

    // Get existing unlocks for this user
    const existingUnlocks = await prisma.userAchievement.findMany({
      where: {
        userId: user.id,
        achievement: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
      select: { achievementId: true },
    });
    const alreadyUnlockedIds = new Set(
      existingUnlocks.map((u) => u.achievementId),
    );

    // Process each achievement from RA
    for (const [externalId, raAchievement] of Object.entries(
      userProgress.Achievements,
    )) {
      if (!raAchievement.DateEarned && !raAchievement.DateEarnedHardcore) {
        // Not unlocked
        continue;
      }

      const achievement = achievementMap.get(externalId);
      if (!achievement) {
        logger.warn(
          `[RA Sync] Achievement not found in DB: gameId=${gameId} externalId=${externalId}`,
        );
        continue;
      }

      const wasAlreadyUnlocked = alreadyUnlockedIds.has(achievement.id);
      if (wasAlreadyUnlocked) {
        continue;
      }

      // Create the unlock record
      const unlockedAt = new Date(
        raAchievement.DateEarned ||
          raAchievement.DateEarnedHardcore ||
          Date.now(),
      );

      await prisma.userAchievement.create({
        data: {
          userId: user.id,
          achievementId: achievement.id,
          unlockedAt,
        },
      });

      syncedCount++;
    }

    if (syncedCount > 0) {
      logger.info(
        `[RA Sync] Synced ${syncedCount} achievements for user ${user.id} game ${gameId}`,
      );
    }
  } catch (error) {
    logger.error(
      `[RA Sync] Error during sync: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { synced: syncedCount };
});
