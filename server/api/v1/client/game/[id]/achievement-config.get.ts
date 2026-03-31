import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Get all achievements for this game
  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    orderBy: { displayOrder: "asc" },
  });

  // Get user's unlocks
  const achievementIds = achievements.map((a) => a.id);
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { in: achievementIds },
    },
  });
  const unlockedSet = new Set(userAchievements.map((ua) => ua.achievementId));

  // Get external link for the game
  const externalLinks = await prisma.gameExternalLink.findMany({
    where: { gameId },
  });

  return {
    achievements: achievements.map((a) => ({
      ...a,
      unlocked: unlockedSet.has(a.id),
    })),
    externalLinks,
  };
});
