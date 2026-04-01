import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Get server-wide stats
  const [
    totalGames,
    totalUsers,
    totalPlaySessions,
    totalAchievementUnlocks,
    _totalPlaytimeRecords,
    totalRequests,
    pendingRequests,
    totalLeaderboardEntries,
  ] = await Promise.all([
    prisma.game.count({ where: { type: "Game" } }),
    prisma.user.count({ where: { enabled: true } }),
    prisma.playSession.count(),
    prisma.userAchievement.count(),
    prisma.playtime.count(),
    prisma.gameRequest.count(),
    prisma.gameRequest.count({ where: { status: "Pending" } }),
    prisma.leaderboardEntry.count(),
  ]);

  // Calculate total playtime hours using DB aggregation (not JS reduce)
  const playtimeAggregate = await prisma.playtime.aggregate({
    _sum: { seconds: true },
  });
  const totalPlaytimeHours = (playtimeAggregate._sum.seconds ?? 0) / 3600;

  return {
    totalGames,
    totalUsers,
    totalPlaytimeHours: Math.round(totalPlaytimeHours),
    totalPlaySessions,
    totalAchievementUnlocks,
    totalRequests,
    pendingRequests,
    totalLeaderboardEntries,
  };
});
