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

  // Auto-close orphaned sessions (started more than 4h ago with no endedAt).
  // Also compute durationSeconds and update cumulative playtime.
  const orphanedSessions = recentSessions.filter(
    (s) =>
      !s.endedAt &&
      Date.now() - new Date(s.startedAt).getTime() > 4 * 60 * 60 * 1000,
  );

  for (const orphan of orphanedSessions) {
    const endedAt = new Date(
      Math.min(
        new Date(orphan.startedAt).getTime() + 24 * 60 * 60 * 1000,
        Date.now(),
      ),
    );
    const durationSeconds = Math.floor(
      (endedAt.getTime() - new Date(orphan.startedAt).getTime()) / 1000,
    );

    await prisma.playSession.updateMany({
      where: { id: orphan.id },
      data: { endedAt, durationSeconds },
    });

    // Upsert cumulative playtime for the game/user pair
    await prisma.playtime.upsert({
      where: {
        gameId_userId: { gameId: orphan.gameId, userId: user.id },
      },
      create: {
        gameId: orphan.gameId,
        userId: user.id,
        seconds: durationSeconds,
      },
      update: {
        seconds: { increment: durationSeconds },
      },
    });

    // Update in-memory copy so the response reflects the fix
    (orphan as { endedAt: Date | null }).endedAt = endedAt;
    (orphan as { durationSeconds: number | null }).durationSeconds =
      durationSeconds;
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
