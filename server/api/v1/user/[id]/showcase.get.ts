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

  const showcases = await prisma.profileShowcase.findMany({
    where: { userId: user.id },
    orderBy: { sortOrder: "asc" },
    take: 12,
    select: {
      id: true,
      type: true,
      gameId: true,
      itemId: true,
      title: true,
      data: true,
      sortOrder: true,
    },
  });

  // Batch-fetch related games
  const gameIds = [
    ...new Set(showcases.map((s) => s.gameId).filter(Boolean)),
  ] as string[];
  const games =
    gameIds.length > 0
      ? await prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: {
            id: true,
            mName: true,
            mIconObjectId: true,
            mCoverObjectId: true,
            mBannerObjectId: true,
          },
        })
      : [];
  const gameMap = Object.fromEntries(games.map((g) => [g.id, g]));

  // Batch-fetch achievement data for Achievement-type items
  const achievementItemIds = showcases
    .filter((s) => s.type === "Achievement" && s.itemId)
    .map((s) => s.itemId as string);
  const achievements =
    achievementItemIds.length > 0
      ? await prisma.achievement.findMany({
          where: { id: { in: achievementItemIds } },
          select: {
            id: true,
            title: true,
            description: true,
            iconUrl: true,
          },
        })
      : [];
  const achievementMap = Object.fromEntries(achievements.map((a) => [a.id, a]));

  // Batch-fetch playtime and achievement stats for ALL game-related items
  // (used by GameStats overlay and completion badges on FavoriteGame items)
  const allShowcaseGameIds = [
    ...new Set(
      showcases.map((s) => s.gameId).filter((id): id is string => !!id),
    ),
  ];
  const playtimeRecords =
    allShowcaseGameIds.length > 0
      ? await prisma.playtime.findMany({
          where: { userId: user.id, gameId: { in: allShowcaseGameIds } },
          select: { gameId: true, seconds: true },
        })
      : [];
  const playtimeMap = Object.fromEntries(
    playtimeRecords.map((p) => [p.gameId, p.seconds]),
  );

  // Batch-fetch achievement counts for all showcase games
  const [totalAchByGame, unlockedAchByGame] = await Promise.all([
    allShowcaseGameIds.length > 0
      ? prisma.achievement.groupBy({
          by: ["gameId"],
          where: { gameId: { in: allShowcaseGameIds } },
          _count: true,
        })
      : Promise.resolve([]),
    allShowcaseGameIds.length > 0
      ? prisma.userAchievement.findMany({
          where: {
            userId: user.id,
            achievement: { gameId: { in: allShowcaseGameIds } },
          },
          select: { achievement: { select: { gameId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const totalAchMap = Object.fromEntries(
    totalAchByGame.map((g) => [g.gameId, g._count]),
  );
  const unlockedAchCountMap: Record<string, number> = {};
  for (const ua of unlockedAchByGame) {
    const gid = ua.achievement.gameId;
    unlockedAchCountMap[gid] = (unlockedAchCountMap[gid] ?? 0) + 1;
  }

  return {
    items: showcases.map((s) => ({
      ...s,
      game: s.gameId ? (gameMap[s.gameId] ?? null) : null,
      achievement:
        s.type === "Achievement" && s.itemId
          ? (achievementMap[s.itemId] ?? null)
          : undefined,
      gameStats: s.gameId
        ? {
            playtimeSeconds: playtimeMap[s.gameId] ?? 0,
            achievementsUnlocked: unlockedAchCountMap[s.gameId] ?? 0,
            achievementsTotal: totalAchMap[s.gameId] ?? 0,
          }
        : undefined,
    })),
  };
});
