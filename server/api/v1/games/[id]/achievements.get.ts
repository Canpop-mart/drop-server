import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    orderBy: { displayOrder: "asc" },
  });

  // Get user's unlocks for this game
  const achievementIds = achievements.map((a) => a.id);
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId,
      achievementId: { in: achievementIds },
    },
  });
  const unlockedMap = Object.fromEntries(
    userAchievements.map((ua) => [ua.achievementId, ua.unlockedAt]),
  );

  // Calculate rarity: count of unlocks per achievement vs total owners
  // Total owners = distinct users who have ANY play session for this game
  const totalOwners = await prisma.playSession.groupBy({
    by: ["userId"],
    where: { gameId },
  });
  const ownerCount = Math.max(totalOwners.length, 1);

  // Count unlocks per achievement in a single query
  const unlockCounts = await prisma.userAchievement.groupBy({
    by: ["achievementId"],
    where: { achievementId: { in: achievementIds } },
    _count: true,
  });
  const unlockCountMap = Object.fromEntries(
    unlockCounts.map((uc) => [uc.achievementId, uc._count]),
  );

  return achievements.map((a) => {
    const unlocks = unlockCountMap[a.id] ?? 0;
    return {
      ...a,
      unlocked: !!unlockedMap[a.id],
      unlockedAt: unlockedMap[a.id] ?? null,
      rarity: Math.round((unlocks / ownerCount) * 100 * 10) / 10,
      unlockCount: unlocks,
    };
  });
});
