import { type, ArkErrors } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";
import notificationSystem from "~/server/internal/notifications";

const AchievementReport = type({
  achievements: type({
    externalId: "string",
    provider: "'Goldberg'",
    unlockedAt: "string",
  }).array(),
});

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const rawBody = await readBody(h3);
  const body = AchievementReport(rawBody);
  if (body instanceof ArkErrors) {
    console.warn(
      `[ACH] Report validation failed for game ${gameId}:`,
      body.summary,
    );
    throw createError({ statusCode: 400, statusMessage: body.summary });
  }

  console.log(
    `[ACH] Report received: game=${gameId} user=${user.id} count=${body.achievements.length}`,
  );

  // Fetch game name + all matching achievements in bulk (avoids N+1)
  const [game, achievements, existingUnlocks] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      select: { mName: true },
    }),
    prisma.achievement.findMany({
      where: {
        gameId,
        provider: "Goldberg" as ExternalAccountProvider,
        externalId: {
          in: body.achievements.map((a) => a.externalId),
        },
      },
    }),
    prisma.userAchievement.findMany({
      where: {
        userId: user.id,
        achievement: {
          gameId,
          externalId: {
            in: body.achievements.map((a) => a.externalId),
          },
        },
      },
      select: { achievementId: true },
    }),
  ]);

  // Build lookup maps
  const achievementMap = new Map(
    achievements.map((a) => [`${a.provider}:${a.externalId}`, a]),
  );
  const alreadyUnlockedIds = new Set(
    existingUnlocks.map((u) => u.achievementId),
  );

  let recorded = 0;
  const newlyUnlocked: { title: string; iconUrl: string }[] = [];

  for (const report of body.achievements) {
    const achievement = achievementMap.get(
      `${report.provider}:${report.externalId}`,
    );
    if (!achievement) {
      console.warn(
        `[ACH] Achievement NOT FOUND in DB: gameId=${gameId} externalId=${report.externalId}`,
      );
      continue;
    }

    const wasAlreadyUnlocked = alreadyUnlockedIds.has(achievement.id);

    await prisma.userAchievement.upsert({
      where: {
        userId_achievementId: {
          userId: user.id,
          achievementId: achievement.id,
        },
      },
      create: {
        userId: user.id,
        achievementId: achievement.id,
        unlockedAt: new Date(report.unlockedAt),
      },
      update: {},
    });

    recorded++;

    if (!wasAlreadyUnlocked) {
      newlyUnlocked.push({
        title: achievement.title,
        iconUrl: achievement.iconUrl ?? "",
      });
    }
  }

  // Push real-time notifications for each newly unlocked achievement
  for (const unlock of newlyUnlocked) {
    await notificationSystem
      .push(user.id, {
        title: unlock.title,
        description: game?.mName ?? "",
        actions: unlock.iconUrl ? [unlock.iconUrl] : [],
        nonce: `achievement-unlock:${gameId}:${unlock.title}:${Date.now()}`,
        acls: ["user:store:read"],
      })
      .catch((err) => {
        console.warn(`[ACH] Failed to push notification: ${err}`);
      });
  }

  console.log(
    `[ACH] Report complete: game=${gameId} recorded=${recorded} newlyUnlocked=${newlyUnlocked.length}`,
  );

  return { recorded };
});
