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
  ] = await Promise.all([
    prisma.game.count({ where: { type: "Game" } }),
    prisma.user.count({ where: { enabled: true } }),
    prisma.playSession.count(),
    prisma.userAchievement.count(),
    prisma.playtime.count(),
    prisma.gameRequest.count(),
    prisma.gameRequest.count({ where: { status: "Pending" } }),
  ]);

  // Calculate total playtime hours
  const playtimeRecords = await prisma.playtime.findMany({
    select: { seconds: true },
  });
  const totalPlaytimeHours =
    playtimeRecords.reduce((sum, p) => sum + p.seconds, 0) / 3600;

  return {
    totalGames,
    totalUsers,
    totalPlaytimeHours: Math.round(totalPlaytimeHours),
    totalPlaySessions,
    totalAchievementUnlocks,
    totalRequests,
    pendingRequests,
  };
});
