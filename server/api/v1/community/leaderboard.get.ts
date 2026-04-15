import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Fetch ALL enabled users first — the Players tab should show everyone
  const users = await prisma.user.findMany({
    where: { enabled: true },
    select: {
      id: true,
      username: true,
      displayName: true,
      profilePictureObjectId: true,
    },
    take: 50,
  });
  const userIds = users.map((u) => u.id);

  // Get playtime totals per user
  const playtimeByUser = await prisma.playtime.groupBy({
    by: ["userId"],
    _sum: { seconds: true },
    _count: true,
    where: { userId: { in: userIds } },
  });
  const playtimeMap = Object.fromEntries(
    playtimeByUser.map((p) => [
      p.userId,
      { seconds: p._sum.seconds ?? 0, games: p._count },
    ]),
  );

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

  // Build leaderboard sorted by playtime (users with no playtime go last)
  const playtimeLeaderboard = users
    .map((u, i) => ({
      rank: i + 1,
      user: u,
      playtimeHours: Math.round((playtimeMap[u.id]?.seconds ?? 0) / 3600),
      gamesPlayed: playtimeMap[u.id]?.games ?? 0,
      achievements: achievementMap[u.id] ?? 0,
      gamesOwned: collectionCountMap[userCollectionIds[u.id] ?? ""] ?? 0,
    }))
    .sort(
      (a, b) =>
        b.playtimeHours - a.playtimeHours || b.gamesPlayed - a.gamesPlayed,
    );

  // Re-assign ranks after sorting
  playtimeLeaderboard.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  return { playtime: playtimeLeaderboard };
});
