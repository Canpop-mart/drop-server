import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { logger } from "~/server/internal/logging";
import {
  getGameAchievementConfig,
  ACHIEVEMENT_CONFIG_TTL_MS,
} from "~/server/internal/achievements/config-cache";

// Lower number = higher priority when deduplicating cross-provider achievements
const PROVIDER_PRIORITY: Record<string, number> = {
  Goldberg: 0,
  RetroAchievements: 1,
};

/**
 * Per-game achievement config for the desktop client.
 *
 * Polled by every running client every ~15s. To keep that from being
 * 4 Prisma round-trips per client per poll, the USER-INDEPENDENT parts
 * (definitions, external links, RA hashes) come from an in-memory cache
 * with a 10s TTL — see server/internal/achievements/config-cache.ts.
 *
 * The per-user `unlocked` overlay is deliberately NOT cached: it's a
 * small indexed query and caching it would risk leaking one user's
 * unlock state into another user's response. So each request still does
 * exactly one fresh `userAchievement.findMany` scoped to the caller.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Cached, user-independent slice (definitions / links / RA hashes).
  const { value: gameConfig, cacheHit } =
    await getGameAchievementConfig(gameId);

  // Deduplicate definitions by externalId across providers.
  const dedupedMap = new Map<
    string,
    { best: (typeof gameConfig.achievements)[0]; allIds: string[] }
  >();
  for (const a of gameConfig.achievements) {
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
  const allAchievementIds = gameConfig.achievements.map((a) => a.id);

  // Fresh, per-user unlock overlay — NOT cached (see header comment).
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { in: allAchievementIds },
    },
  });
  const unlockedSet = new Set(userAchievements.map((ua) => ua.achievementId));

  const result = {
    achievements: dedupedEntries.map(({ best, allIds }) => ({
      ...best,
      // Unlocked if ANY provider variant is unlocked for this user
      unlocked: allIds.some((id) => unlockedSet.has(id)),
    })),
    externalLinks: gameConfig.externalLinks,
    raHashes: gameConfig.raHashes,
    raConsoleId: gameConfig.raConsoleId,
  };

  logger.info(
    `[ACH] Config served: game=${gameId} user=${user.id} total=${result.achievements.length} ` +
      `unlocked=${result.achievements.filter((a) => a.unlocked).length} ` +
      `cache=${cacheHit ? "HIT" : "MISS"} (ttl=${ACHIEVEMENT_CONFIG_TTL_MS}ms)`,
  );

  return result;
});
