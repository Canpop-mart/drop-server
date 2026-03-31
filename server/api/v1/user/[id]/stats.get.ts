import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const requestingUser = await aclManager.getUserACL(h3, ["read"]);
  if (!requestingUser) throw createError({ statusCode: 403 });

  const userId = getRouterParam(h3, "id");
  if (!userId)
    throw createError({
      statusCode: 400,
      statusMessage: "No userId in route.",
    });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  // Total playtime
  const playtimeRecords = await prisma.playtime.findMany({
    where: { userId },
    select: { seconds: true },
  });
  const totalPlaytimeSeconds = playtimeRecords.reduce(
    (sum, p) => sum + p.seconds,
    0,
  );

  // Games played count
  const gamesPlayed = playtimeRecords.length;

  // Achievements unlocked
  const achievementsUnlocked = await prisma.userAchievement.count({
    where: { userId },
  });

  // Recent sessions
  const recentSessions = await prisma.playSession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      id: true,
      gameId: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
    },
  });

  const gameIds = [...new Set(recentSessions.map((s) => s.gameId))];
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

  return {
    totalPlaytimeSeconds,
    gamesPlayed,
    achievementsUnlocked,
    recentSessions: recentSessions.map((s) => ({
      ...s,
      game: gameMap[s.gameId] ?? null,
    })),
  };
});
