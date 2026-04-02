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

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: userId }, { username: userId }],
    },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  // Total playtime
  const playtimeRecords = await prisma.playtime.findMany({
    where: { userId: user.id },
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
    where: { userId: user.id },
  });

  // Recent sessions
  const recentSessions = await prisma.playSession.findMany({
    where: { userId: user.id },
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

  // Auto-close orphaned sessions (started more than 24h ago with no endedAt)
  const orphanedIds = recentSessions
    .filter(
      (s) =>
        !s.endedAt &&
        Date.now() - new Date(s.startedAt).getTime() > 24 * 60 * 60 * 1000,
    )
    .map((s) => s.id);

  if (orphanedIds.length > 0) {
    await prisma.playSession.updateMany({
      where: { id: { in: orphanedIds } },
      data: { endedAt: new Date() },
    });
  }

  return {
    totalPlaytimeSeconds,
    gamesPlayed,
    achievementsUnlocked,
    recentSessions: recentSessions.map((s) => {
      // Compute duration: stored > from timestamps > from startedAt to now
      const duration =
        s.durationSeconds ??
        (s.endedAt
          ? Math.floor(
              (new Date(s.endedAt).getTime() -
                new Date(s.startedAt).getTime()) /
                1000,
            )
          : Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));

      return {
        ...s,
        durationSeconds: duration > 0 ? duration : null,
        game: gameMap[s.gameId] ?? null,
      };
    }),
  };
});
