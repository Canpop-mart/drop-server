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
    `[ACH] Report received: game=${gameId} user=${user.id} count=${body.achievements.length} ids=[${body.achievements.map((a) => a.externalId).join(", ")}]`,
  );

  // Fetch game name once for notifications
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { mName: true },
  });

  let recorded = 0;
  const newlyUnlocked: { title: string; iconUrl: string }[] = [];

  for (const report of body.achievements) {
    // Find the achievement in our DB
    const achievement = await prisma.achievement.findUnique({
      where: {
        gameId_provider_externalId: {
          gameId,
          provider: report.provider as ExternalAccountProvider,
          externalId: report.externalId,
        },
      },
    });

    if (!achievement) {
      console.warn(
        `[ACH] Achievement NOT FOUND in DB: gameId=${gameId} provider=${report.provider} externalId=${report.externalId}`,
      );
      continue;
    }

    // Check if already unlocked for this specific achievement record
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId: user.id,
          achievementId: achievement.id,
        },
      },
    });

    // Check if ANY provider variant of this externalId is already unlocked
    // (prevents duplicate notifications when multiple providers report the same achievement)
    const anyProviderUnlocked = existing
      ? true
      : await prisma.userAchievement
          .findFirst({
            where: {
              userId: user.id,
              achievement: {
                gameId,
                externalId: report.externalId,
              },
            },
          })
          .then((r) => !!r);

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

    // Track newly unlocked achievements for notifications — only if no provider variant was previously unlocked
    if (!anyProviderUnlocked) {
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
        // Store icon URL in actions field for the toast to use
        actions: unlock.iconUrl ? [unlock.iconUrl] : [],
        nonce: `achievement-unlock:${gameId}:${unlock.title}:${Date.now()}`,
        acls: ["user:store:read"],
      })
      .catch(() => {
        // Non-critical — don't fail the report if notification fails
      });
  }

  console.log(
    `[ACH] Report complete: game=${gameId} recorded=${recorded} newlyUnlocked=${newlyUnlocked.length}`,
  );

  return { recorded };
});
