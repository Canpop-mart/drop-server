import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

// Lower number = higher priority when deduplicating cross-provider achievements
const PROVIDER_PRIORITY: Record<string, number> = {
  Goldberg: 0,
};

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

  // Deduplicate by externalId — a game can have the same achievement stored
  // from multiple providers. Keep the highest-priority
  // provider's metadata for display, but track all IDs so we can merge unlock data.
  const dedupedMap = new Map<
    string,
    { best: (typeof achievements)[0]; allIds: string[] }
  >();
  for (const a of achievements) {
    const entry = dedupedMap.get(a.externalId);
    if (!entry) {
      dedupedMap.set(a.externalId, { best: a, allIds: [a.id] });
    } else {
      entry.allIds.push(a.id);
      const newPriority = PROVIDER_PRIORITY[a.provider] ?? 99;
      const bestPriority = PROVIDER_PRIORITY[entry.best.provider] ?? 99;
      if (newPriority < bestPriority) {
        entry.best = a;
      }
    }
  }

  const dedupedEntries = [...dedupedMap.values()];
  const allAchievementIds = achievements.map((a) => a.id);

  // Get user's unlocks — check across ALL provider IDs for each externalId group
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId,
      achievementId: { in: allAchievementIds },
    },
  });
  // Map: achievementId -> unlockedAt
  const unlockedByAchId = Object.fromEntries(
    userAchievements.map((ua) => [ua.achievementId, ua.unlockedAt]),
  );

  // Calculate rarity: count of unlocks per achievement vs total owners
  // Total owners = distinct users who have ANY play session for this game
  const totalOwners = await prisma.playSession.groupBy({
    by: ["userId"],
    where: { gameId },
  });
  const ownerCount = Math.max(totalOwners.length, 1);

  // Count unlocks per achievement across all provider variants
  const unlockCounts = await prisma.userAchievement.groupBy({
    by: ["achievementId"],
    where: { achievementId: { in: allAchievementIds } },
    _count: true,
  });
  const unlockCountByAchId = Object.fromEntries(
    unlockCounts.map((uc) => [uc.achievementId, uc._count]),
  );

  return dedupedEntries.map(({ best, allIds }) => {
    // Merge unlock status: unlocked if ANY provider variant is unlocked
    let unlockedAt: Date | null = null;
    for (const id of allIds) {
      const t = unlockedByAchId[id];
      if (t && (!unlockedAt || t < unlockedAt)) {
        // Use the earliest unlock time if multiple providers reported it
        unlockedAt = t;
      }
    }

    // Merge unlock counts: sum across all provider variants
    const unlocks = allIds.reduce(
      (sum, id) => sum + (unlockCountByAchId[id] ?? 0),
      0,
    );

    return {
      ...best,
      unlocked: !!unlockedAt,
      unlockedAt,
      rarity: Math.round((unlocks / ownerCount) * 100 * 10) / 10,
      unlockCount: unlocks,
    };
  });
});
