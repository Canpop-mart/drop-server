import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";
import notificationSystem from "~/server/internal/notifications";

/**
 * Called by the desktop client during gameplay to poll for newly unlocked
 * RetroAchievements. Checks the RA API for user progress, diffs against
 * existing UserAchievement records, creates new unlock records, and returns
 * the list of newly unlocked achievements.
 *
 * This replaces the session-end-only RA sync with real-time polling.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

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
    logger.info(`[RA-POLL] No RA link for game ${gameId}`);
    return { newlyUnlocked: [] };
  }

  // Resolve RA API credentials (for making API calls)
  const raCreds = await resolveRACredentials(user.id);
  if (!raCreds) {
    logger.warn(`[RA-POLL] No RA credentials for user ${user.id}`);
    return { newlyUnlocked: [] };
  }

  // Get user's linked RA account (for querying their progress)
  const userRaAccount = await prisma.userExternalAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
  });

  if (!userRaAccount || !userRaAccount.externalId || !userRaAccount.token) {
    logger.warn(
      `[RA-POLL] Missing RA account data for user ${user.id}: account=${!!userRaAccount}, externalId=${userRaAccount?.externalId}, hasToken=${!!userRaAccount?.token}`,
    );
    return { newlyUnlocked: [] };
  }

  const raClient = createRAClient(raCreds.username, raCreds.apiKey);
  const raGameId = parseInt(raLink.externalGameId, 10);

  try {
    const userProgress = await raClient.getUserGameProgress(
      userRaAccount.externalId,
      userRaAccount.token,
      raGameId,
    );

    if (!userProgress || !userProgress.Achievements) {
      logger.warn(
        `[RA-POLL] Empty progress from RA API for user=${userRaAccount.externalId} game=${raGameId}`,
      );
      return { newlyUnlocked: [] };
    }

    const raAchievements = Object.entries(userProgress.Achievements);
    const raUnlocked = raAchievements.filter(
      ([, a]) => a.DateEarned || a.DateEarnedHardcore,
    );
    logger.info(
      `[RA-POLL] RA API returned ${raAchievements.length} achievements, ${raUnlocked.length} unlocked for user=${userRaAccount.externalId} raGame=${raGameId}`,
    );

    // Get all RA achievements for this game from DB
    const achievements = await prisma.achievement.findMany({
      where: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    });

    const achievementMap = new Map(achievements.map((a) => [a.externalId, a]));

    // Get existing unlocks
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

    logger.info(
      `[RA-POLL] DB state: ${achievements.length} achievements in DB, ${alreadyUnlockedIds.size} already unlocked by user`,
    );

    // Get game name for notifications
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { mName: true },
    });

    const newlyUnlocked: {
      id: string;
      externalId: string;
      title: string;
      description: string;
      iconUrl: string;
    }[] = [];

    for (const [externalId, raAchievement] of Object.entries(
      userProgress.Achievements,
    )) {
      if (!raAchievement.DateEarned && !raAchievement.DateEarnedHardcore) {
        continue;
      }

      const achievement = achievementMap.get(externalId);
      if (!achievement) continue;

      if (alreadyUnlockedIds.has(achievement.id)) continue;

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

      newlyUnlocked.push({
        id: achievement.id,
        externalId: achievement.externalId,
        title: achievement.title,
        description: achievement.description ?? "",
        iconUrl: achievement.iconUrl ?? "",
      });

      // Push real-time notification
      await notificationSystem
        .push(user.id, {
          title: achievement.title,
          description: game?.mName ?? "",
          actions: achievement.iconUrl ? [achievement.iconUrl] : [],
          nonce: `achievement-unlock:${gameId}:${achievement.title}:${Date.now()}`,
          acls: ["user:store:read"],
        })
        .catch((err) => {
          logger.warn(`[RA-POLL] Failed to push notification: ${err}`);
        });
    }

    if (newlyUnlocked.length > 0) {
      logger.info(
        `[RA-POLL] ${newlyUnlocked.length} new achievements for user ${user.id} game ${gameId}: ${newlyUnlocked.map((a) => a.title).join(", ")}`,
      );
    }

    return { newlyUnlocked };
  } catch (error) {
    logger.error(
      `[RA-POLL] Error polling RA: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { newlyUnlocked: [] };
  }
});
