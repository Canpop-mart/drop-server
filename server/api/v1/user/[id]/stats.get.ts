import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { mergeAndSumSessions } from "~/server/internal/playtime/merge-sessions";

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

  // Games played count (read early, recompute playtime after orphan cleanup)
  const gamesPlayed = await prisma.playtime.count({
    where: { userId: user.id },
  });

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
      lastHeartbeatAt: true,
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
  // If a heartbeat was received, use it as the end time for better accuracy.
  const orphanedSessions = recentSessions.filter(
    (s) =>
      !s.endedAt &&
      Date.now() - new Date(s.startedAt).getTime() > 4 * 60 * 60 * 1000,
  );

  const affectedGameIds = new Set<string>();

  for (const orphan of orphanedSessions) {
    // Prefer lastHeartbeatAt (more accurate) over now (assumes game ran the whole time)
    const endedAt = orphan.lastHeartbeatAt
      ? new Date(orphan.lastHeartbeatAt)
      : new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - new Date(orphan.startedAt).getTime()) / 1000,
    );

    await prisma.playSession.updateMany({
      where: { id: orphan.id },
      data: { endedAt, durationSeconds },
    });

    affectedGameIds.add(orphan.gameId);

    // Update in-memory copy so the response reflects the fix
    (orphan as { endedAt: Date | null }).endedAt = endedAt;
    (orphan as { durationSeconds: number | null }).durationSeconds =
      durationSeconds;
  }

  // Recompute cumulative playtime using interval merging
  for (const gameId of affectedGameIds) {
    const sessions = await prisma.playSession.findMany({
      where: {
        gameId,
        userId: user.id,
        endedAt: { not: null },
      },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, endedAt: true },
    });

    const totalSeconds = mergeAndSumSessions(sessions);

    await prisma.playtime.upsert({
      where: { gameId_userId: { gameId, userId: user.id } },
      create: { gameId, userId: user.id, seconds: totalSeconds },
      update: { seconds: totalSeconds },
    });
  }

  // Read total playtime AFTER orphan cleanup so the values are fresh
  const playtimeRecords = await prisma.playtime.findMany({
    where: { userId: user.id },
    select: { seconds: true },
  });
  const totalPlaytimeSeconds = playtimeRecords.reduce(
    (sum, p) => sum + p.seconds,
    0,
  );

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
