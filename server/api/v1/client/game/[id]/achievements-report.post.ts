import { type } from "arktype";
import { ArkErrors } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

const AchievementReport = type({
  achievements: type({
    externalId: "string",
    provider: "'Steam' | 'RetroAchievements' | 'Goldberg'",
    unlockedAt: "string",
  }).array(),
});

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId) throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const rawBody = await readBody(h3);
  const body = AchievementReport(rawBody);
  if (body instanceof ArkErrors) {
    throw createError({ statusCode: 400, statusMessage: body.summary });
  }

  let recorded = 0;

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

    if (!achievement) continue;

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
  }

  return { recorded };
});
