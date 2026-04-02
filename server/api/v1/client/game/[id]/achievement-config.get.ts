import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

// Lower number = higher priority when deduplicating cross-provider achievements
const PROVIDER_PRIORITY: Record<string, number> = {
  Goldberg: 0,
};

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Get all achievements for this game
  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    orderBy: { displayOrder: "asc" },
  });

  // Deduplicate by externalId across providers
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
      if (newPriority < bestPriority) entry.best = a;
    }
  }

  const dedupedEntries = [...dedupedMap.values()];
  const allAchievementIds = achievements.map((a) => a.id);

  // Get user's unlocks — merged across all provider variants per externalId
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { in: allAchievementIds },
    },
  });
  const unlockedSet = new Set(userAchievements.map((ua) => ua.achievementId));

  // Get external link for the game
  const externalLinks = await prisma.gameExternalLink.findMany({
    where: { gameId },
  });

  return {
    achievements: dedupedEntries.map(({ best, allIds }) => ({
      ...best,
      // Unlocked if ANY provider variant is unlocked for this user
      unlocked: allIds.some((id) => unlockedSet.has(id)),
    })),
    externalLinks,
  };
});
