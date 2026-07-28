import prisma from "../db/database";

// Lower number = higher priority when deduplicating cross-provider achievements.
const PROVIDER_PRIORITY: Record<string, number> = {
  Goldberg: 0,
};

/**
 * Per-achievement unlock detail for one user + one game — the display shape the
 * client renders both on the game achievements list and on the Steam-style
 * side-by-side comparison.
 *
 * Cross-provider variants (same `externalId`) are deduped to one row: unlock
 * status is merged (unlocked if ANY variant is, earliest time wins), `points`
 * is the max across variants, and `rarity` is unlocks/owners across the whole
 * server. Extracted from `GET /games/{id}/achievements` so that endpoint (the
 * caller's set) and `GET /user/{id}/achievements/{gameId}` (another user's set,
 * for comparison) compute IDENTICALLY — a faithful side-by-side depends on it.
 */
export async function computeGameAchievementsForUser(
  userId: string,
  gameId: string,
) {
  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    orderBy: { displayOrder: "asc" },
  });

  // Dedup by externalId, keeping the highest-priority provider's metadata for
  // display but tracking every variant id so unlock data can be merged.
  const dedupedMap = new Map<
    string,
    { best: (typeof achievements)[0]; allIds: string[]; maxPoints: number }
  >();
  for (const a of achievements) {
    const entry = dedupedMap.get(a.externalId);
    if (!entry) {
      dedupedMap.set(a.externalId, {
        best: a,
        allIds: [a.id],
        maxPoints: a.points,
      });
    } else {
      entry.allIds.push(a.id);
      // Points live on the RA variant; the "best" display row is often the
      // 0-point Goldberg/Steam variant, so carry the max.
      entry.maxPoints = Math.max(entry.maxPoints, a.points);
      const newPriority = PROVIDER_PRIORITY[a.provider] ?? 99;
      const bestPriority = PROVIDER_PRIORITY[entry.best.provider] ?? 99;
      if (newPriority < bestPriority) entry.best = a;
    }
  }

  const dedupedEntries = [...dedupedMap.values()];
  const allAchievementIds = achievements.map((a) => a.id);

  // This user's unlocks across all provider variants.
  const userAchievements = await prisma.userAchievement.findMany({
    where: { userId, achievementId: { in: allAchievementIds } },
  });
  const unlockedByAchId = Object.fromEntries(
    userAchievements.map((ua) => [ua.achievementId, ua.unlockedAt]),
  );

  // Rarity denominator: distinct users with any play session for this game.
  const totalOwners = await prisma.playSession.groupBy({
    by: ["userId"],
    where: { gameId },
  });
  const ownerCount = Math.max(totalOwners.length, 1);

  const unlockCounts = await prisma.userAchievement.groupBy({
    by: ["achievementId"],
    where: { achievementId: { in: allAchievementIds } },
    _count: true,
  });
  const unlockCountByAchId = Object.fromEntries(
    unlockCounts.map((uc) => [uc.achievementId, uc._count]),
  );

  return dedupedEntries.map(({ best, allIds, maxPoints }) => {
    let unlockedAt: Date | null = null;
    for (const id of allIds) {
      const t = unlockedByAchId[id];
      if (t && (!unlockedAt || t < unlockedAt)) unlockedAt = t;
    }
    const unlocks = allIds.reduce(
      (sum, id) => sum + (unlockCountByAchId[id] ?? 0),
      0,
    );

    return {
      ...best,
      points: maxPoints,
      unlocked: !!unlockedAt,
      unlockedAt,
      rarity: Math.round((unlocks / ownerCount) * 100 * 10) / 10,
      unlockCount: unlocks,
    };
  });
}
