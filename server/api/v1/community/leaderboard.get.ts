import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const BOARD_SIZE = 50;

  // Rank in the database. This used to take an arbitrary 50 enabled users and
  // then sort those in JS, so on a server with more than 50 players "Top
  // players" was 50 random people rather than the top 50.
  const playtimeByUser = await prisma.playtime.groupBy({
    by: ["userId"],
    _sum: { seconds: true },
    _count: true,
    where: { user: { enabled: true, username: { not: "system" } } },
    orderBy: { _sum: { seconds: "desc" } },
    take: BOARD_SIZE,
  });
  const playtimeMap = Object.fromEntries(
    playtimeByUser.map((p) => [
      p.userId,
      { seconds: p._sum.seconds ?? 0, games: p._count },
    ]),
  );

  const rankedIds = playtimeByUser.map((p) => p.userId);
  const userSelect = {
    id: true,
    username: true,
    displayName: true,
    profilePictureObjectId: true,
  } as const;
  // The Players tab should still show everyone on a small server, so any slots
  // the ranking left over go to enabled users who have never played anything.
  const backfill = Math.max(0, BOARD_SIZE - rankedIds.length);
  const [rankedUsers, idleUsers] = await Promise.all([
    rankedIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: rankedIds } },
          select: userSelect,
        })
      : [],
    backfill > 0
      ? prisma.user.findMany({
          where: {
            enabled: true,
            username: { not: "system" },
            id: { notIn: rankedIds },
          },
          select: userSelect,
          take: backfill,
        })
      : [],
  ]);

  const rankedUserMap = new Map(rankedUsers.map((u) => [u.id, u]));
  const users = [
    ...rankedIds.map((id) => rankedUserMap.get(id)).filter((u) => !!u),
    ...idleUsers,
  ];
  const userIds = users.map((u) => u.id);

  // Get achievement counts per user
  const achievementByUser = await prisma.userAchievement.groupBy({
    by: ["userId"],
    _count: true,
    where: { userId: { in: userIds } },
  });
  const achievementMap = Object.fromEntries(
    achievementByUser.map((a) => [a.userId, a._count]),
  );

  // Get user collections for games owned
  const collections = await prisma.collection.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, id: true },
  });
  const userCollectionIds = Object.fromEntries(
    collections.map((c) => [c.userId, c.id]),
  );

  const collectionEntries = await prisma.collectionEntry.groupBy({
    by: ["collectionId"],
    _count: true,
    where: { collectionId: { in: Object.values(userCollectionIds) } },
  });
  const collectionCountMap = Object.fromEntries(
    collectionEntries.map((c) => [c.collectionId, c._count]),
  );

  // `users` is already in rank order (database ranking by exact seconds, then
  // the never-played backfill), so there is nothing left to sort here. The old
  // JS sort compared hours rounded to integers, which flattened everyone inside
  // the same hour into a tie.
  const playtimeLeaderboard = users.map((u, i) => ({
    rank: i + 1,
    user: u,
    playtimeHours: Math.round((playtimeMap[u.id]?.seconds ?? 0) / 3600),
    gamesPlayed: playtimeMap[u.id]?.games ?? 0,
    achievements: achievementMap[u.id] ?? 0,
    gamesOwned: collectionCountMap[userCollectionIds[u.id] ?? ""] ?? 0,
  }));

  return { playtime: playtimeLeaderboard };
});
