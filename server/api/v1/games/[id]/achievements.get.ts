import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    orderBy: { displayOrder: "asc" },
  });

  // Get user's unlocks for this game
  const achievementIds = achievements.map((a) => a.id);
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId,
      achievementId: { in: achievementIds },
    },
  });
  const unlockedMap = Object.fromEntries(
    userAchievements.map((ua) => [ua.achievementId, ua.unlockedAt]),
  );

  return achievements.map((a) => ({
    ...a,
    unlocked: !!unlockedMap[a.id],
    unlockedAt: unlockedMap[a.id] ?? null,
  }));
});
