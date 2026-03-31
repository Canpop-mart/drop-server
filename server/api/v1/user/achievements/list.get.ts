import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { Prisma } from "~/prisma/client/client";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const gameId = query.gameId as string | undefined;

  const where: Prisma.UserAchievementWhereInput = { userId };

  const userAchievements = await prisma.userAchievement.findMany({
    where,
    orderBy: { unlockedAt: "desc" },
  });

  // Fetch achievement details
  const achievementIds = userAchievements.map((ua) => ua.achievementId);
  const achievements = await prisma.achievement.findMany({
    where: {
      id: { in: achievementIds },
      ...(gameId && { gameId }),
    },
  });
  const achievementMap = Object.fromEntries(achievements.map((a) => [a.id, a]));

  // Fetch game info
  const gameIds = [...new Set(achievements.map((a) => a.gameId))];
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: {
      id: true,
      mName: true,
      mIconObjectId: true,
      mCoverObjectId: true,
    },
  });
  const gameMap = Object.fromEntries(games.map((g) => [g.id, g]));

  return userAchievements
    .filter((ua) => achievementMap[ua.achievementId])
    .map((ua) => {
      const achievement = achievementMap[ua.achievementId];
      return {
        ...ua,
        achievement,
        game: gameMap[achievement.gameId] ?? null,
      };
    });
});
