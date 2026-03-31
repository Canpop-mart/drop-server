import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const requestingUser = await aclManager.getUserACL(h3, ["read"]);
  if (!requestingUser) throw createError({ statusCode: 403 });

  const userId = getRouterParam(h3, "id");
  if (!userId) throw createError({ statusCode: 400, statusMessage: "No userId in route." });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw createError({ statusCode: 404, statusMessage: "User not found." });

  // Recent play sessions
  const sessions = await prisma.playSession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  // Recent achievements
  const achievements = await prisma.userAchievement.findMany({
    where: { userId },
    orderBy: { unlockedAt: "desc" },
    take: 10,
  });

  // Fetch game info for sessions
  const sessionGameIds = [...new Set(sessions.map((s) => s.gameId))];
  const achievementIds = achievements.map((a) => a.achievementId);

  const [sessionGames, achievementRecords] = await Promise.all([
    prisma.game.findMany({
      where: { id: { in: sessionGameIds } },
      select: { id: true, mName: true, mIconObjectId: true, mCoverObjectId: true },
    }),
    prisma.achievement.findMany({
      where: { id: { in: achievementIds } },
      select: { id: true, title: true, description: true, iconUrl: true, gameId: true },
    }),
  ]);

  const gameMap = Object.fromEntries(sessionGames.map((g) => [g.id, g]));
  const achievementMap = Object.fromEntries(achievementRecords.map((a) => [a.id, a]));

  // Fetch game info for achievements too
  const achievementGameIds = [...new Set(achievementRecords.map((a) => a.gameId))];
  const achievementGames = await prisma.game.findMany({
    where: { id: { in: achievementGameIds } },
    select: { id: true, mName: true, mIconObjectId: true },
  });
  const achievementGameMap = Object.fromEntries(achievementGames.map((g) => [g.id, g]));

  return {
    sessions: sessions.map((s) => ({
      ...s,
      game: gameMap[s.gameId] ?? null,
    })),
    achievements: achievements.map((a) => {
      const achievement = achievementMap[a.achievementId];
      return {
        ...a,
        achievement: achievement ?? null,
        game: achievement ? achievementGameMap[achievement.gameId] ?? null : null,
      };
    }),
  };
});
