import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId) throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Delete all user achievements for this game's achievements
  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    select: { id: true },
  });
  const achievementIds = achievements.map((a) => a.id);

  const deletedUnlocks = await prisma.userAchievement.deleteMany({
    where: { achievementId: { in: achievementIds } },
  });

  // Delete all achievements for this game
  const deletedAchievements = await prisma.achievement.deleteMany({
    where: { gameId },
  });

  return {
    deletedAchievements: deletedAchievements.count,
    deletedUnlocks: deletedUnlocks.count,
  };
});
