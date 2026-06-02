/**
 * Server-side cache for the game-scoped half of the achievement config
 * payload (`GET /api/v1/client/game/:id/achievement-config`).
 *
 * Why this exists (2026 achievements audit, docs/audit/achievements-2026.md):
 * every running desktop client polls `achievement-config` every ~15s. Each
 * poll previously did 4 Prisma round-trips (achievements, external links,
 * RA hashes, user unlocks). With N players in a game that's 4N queries
 * every 15s for data that barely changes.
 *
 * What is cached: the USER-INDEPENDENT parts only — achievement
 * definitions, external links, RA hashes. These are identical for every
 * player of a game, so one entry serves all of them.
 *
 * What is NOT cached: the per-user `unlocked` overlay. That stays a fresh
 * (small, indexed) `userAchievement.findMany` on every request, so a
 * player always sees their own unlock state immediately and one user's
 * unlocks can never leak into another's cached entry.
 *
 * TTL is 10s — comfortably under the 15s client poll interval, so a
 * client effectively gets a fresh-ish snapshot every poll while bursts of
 * concurrent players collapse onto one DB read.
 */
import prisma from "~/server/internal/db/database";

/** Cache TTL. MUST stay <= the 15s client poll interval. */
export const ACHIEVEMENT_CONFIG_TTL_MS = 10_000;

/** The user-independent slice of the achievement-config payload. */
export interface CachedGameAchievementConfig {
  achievements: {
    id: string;
    gameId: string;
    externalId: string;
    provider: string;
    title: string;
    description: string;
    iconUrl: string;
    iconLockedUrl: string;
    displayOrder: number;
  }[];
  externalLinks: {
    id: string;
    gameId: string;
    provider: string;
    externalGameId: string;
    consoleId: number | null;
  }[];
  raHashes: { hash: string; label: string; patchUrl: string }[];
  raConsoleId: number | null;
}

interface CacheEntry {
  value: CachedGameAchievementConfig;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
// In-flight de-dup: if 50 clients miss the cache in the same tick we only
// want ONE DB read, not 50. Promise is shared until it settles.
const inflight = new Map<string, Promise<CachedGameAchievementConfig>>();

async function loadFromDb(
  gameId: string,
): Promise<CachedGameAchievementConfig> {
  const [achievements, externalLinks, raHashes] = await Promise.all([
    prisma.achievement.findMany({
      where: { gameId },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.gameExternalLink.findMany({ where: { gameId } }),
    prisma.gameExternalHash.findMany({
      where: { gameId },
      select: { hash: true, label: true, patchUrl: true },
    }),
  ]);

  const raLink = externalLinks.find((l) => l.provider === "RetroAchievements");

  return {
    achievements: achievements.map((a) => ({
      id: a.id,
      gameId: a.gameId,
      externalId: a.externalId,
      provider: a.provider,
      title: a.title,
      description: a.description,
      iconUrl: a.iconUrl,
      iconLockedUrl: a.iconLockedUrl,
      displayOrder: a.displayOrder,
      points: a.points,
      globalPercent: a.globalPercent,
    })),
    externalLinks: externalLinks.map((l) => ({
      id: l.id,
      gameId: l.gameId,
      provider: l.provider,
      externalGameId: l.externalGameId,
      consoleId: l.consoleId,
    })),
    raHashes,
    raConsoleId: raLink?.consoleId ?? null,
  };
}

/**
 * Returns the user-independent achievement config for a game, served from
 * an in-memory entry when it's younger than ACHIEVEMENT_CONFIG_TTL_MS.
 * Concurrent misses share a single DB read.
 */
export async function getGameAchievementConfig(
  gameId: string,
): Promise<{ value: CachedGameAchievementConfig; cacheHit: boolean }> {
  const now = Date.now();
  const hit = cache.get(gameId);
  if (hit && hit.expiresAt > now) {
    return { value: hit.value, cacheHit: true };
  }

  // Coalesce concurrent misses onto one load.
  let loader = inflight.get(gameId);
  if (!loader) {
    loader = loadFromDb(gameId)
      .then((value) => {
        cache.set(gameId, {
          value,
          expiresAt: Date.now() + ACHIEVEMENT_CONFIG_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        inflight.delete(gameId);
      });
    inflight.set(gameId, loader);
  }
  const value = await loader;
  return { value, cacheHit: false };
}

/**
 * Drop a game's cached entry — call after a scan / link change so the
 * next poll reflects new definitions immediately instead of waiting out
 * the TTL.
 */
export function invalidateGameAchievementConfig(gameId: string): void {
  cache.delete(gameId);
}
