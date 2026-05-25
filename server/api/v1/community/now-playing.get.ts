import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * "Around right now" — currently-active play sessions across the community.
 *
 * A session is considered active if `endedAt` is null AND it either sent a
 * heartbeat within the last ~5 minutes, or (for sessions that haven't
 * heartbeated yet) was started within that window. Orphaned sessions whose
 * client died without a stop event are filtered out by the freshness check;
 * the background orphan-cleanup task eventually closes them.
 *
 * Returns an array of flat entries with the user's display name + avatar and
 * the game's id/name/cover, in the shape the community front-end expects.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const STALE_AFTER_MS = 5 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);

  const sessions = await prisma.playSession.findMany({
    where: {
      endedAt: null,
      OR: [
        { lastHeartbeatAt: { gte: staleCutoff } },
        { lastHeartbeatAt: null, startedAt: { gte: staleCutoff } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      id: true,
      userId: true,
      gameId: true,
      startedAt: true,
    },
  });

  if (sessions.length === 0) return [];

  // De-dup by user — if someone has two un-ended sessions (rare but possible
  // after a crash), keep the most recently started one.
  const seen = new Set<string>();
  const uniqueSessions = sessions.filter((s) => {
    if (seen.has(s.userId)) return false;
    seen.add(s.userId);
    return true;
  });

  const userIds = [...new Set(uniqueSessions.map((s) => s.userId))];
  const gameIds = [...new Set(uniqueSessions.map((s) => s.gameId))];

  const [users, games] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: userIds },
        enabled: true,
        username: { not: "system" },
      },
      select: {
        id: true,
        displayName: true,
        profilePictureObjectId: true,
      },
    }),
    prisma.game.findMany({
      where: { id: { in: gameIds } },
      select: {
        id: true,
        mName: true,
        mCoverObjectId: true,
      },
    }),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const gameMap = new Map(games.map((g) => [g.id, g]));

  return uniqueSessions
    .filter((s) => userMap.has(s.userId) && gameMap.has(s.gameId))
    .map((s) => {
      const user = userMap.get(s.userId)!;
      const game = gameMap.get(s.gameId)!;
      return {
        userId: user.id,
        displayName: user.displayName,
        avatarObjectId: user.profilePictureObjectId || null,
        game: {
          id: game.id,
          name: game.mName,
          coverObjectId: game.mCoverObjectId || null,
        },
        startedAt: s.startedAt.toISOString(),
      };
    });
});
