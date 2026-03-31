import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Get top users by total playtime (auto-calculated)
  const playtimeByUser = await prisma.playtime.groupBy({
    by: ["userId"],
    _sum: { seconds: true },
    _count: true,
    orderBy: { _sum: { seconds: "desc" } },
    take: 20,
  });

  // Get top users by achievement count
  const achievementByUser = await prisma.userAchievement.groupBy({
    by: ["userId"],
    _count: true,
    orderBy: { _count: { achievementId: "desc" } },
    take: 20,
  });

  // Get top users by games owned
  const gamesByUser = await prisma.collectionEntry.groupBy({
    by: ["collection"],
    _count: true,
    take: 20,
  });

  // Fetch user details for all these users
  const userIds = new Set([
    ...playtimeByUser.map((p) => p.userId),
    ...achievementByUser.map((a) => a.userId),
  ]);

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: {
      id: true,
      username: true,
      displayName: true,
      profilePictureObjectId: true,
    },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Get user collections for games owned
  const collections = await prisma.collection.findMany({
    where: { userId: { in: [...userIds] } },
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

  const playtimeLeaderboard = playtimeByUser.map((p, i) => ({
    rank: i + 1,
    user: userMap[p.userId] ?? null,
    playtimeHours: Math.round((p._sum.seconds ?? 0) / 3600),
    gamesPlayed: p._count,
    achievements:
      achievementByUser.find((a) => a.userId === p.userId)?._count ?? 0,
    gamesOwned:
      collectionCountMap[userCollectionIds[p.userId] ?? ""] ?? 0,
  }));

  return { playtime: playtimeLeaderboard };
});
