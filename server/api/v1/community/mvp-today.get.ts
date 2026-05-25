import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * "Tonight's MVP" — the user with the most activity today.
 *
 * score = today_session_seconds + (today_achievement_unlocks * 600)
 *
 * The 600 weight roughly equates one achievement to 10 minutes of playtime
 * so a person grinding unlocks doesn't get out-pointed by someone idling
 * a single long session.
 *
 * "Today" = sessions whose `startedAt >= start of current day (server time)`
 * plus unlocks whose `unlockedAt >= start of current day`. The system user
 * is excluded.
 *
 * Returns null when nobody has activity yet — the front-end soft-fails to
 * "no crown" in that case.
 *
 * Cached in-process for up to 1h, keyed by the day bucket. The data is
 * cheap to recompute, but most renders within a given hour will see the
 * same answer so caching is a clear win for the leaderboard tile.
 */
type MvpResult = {
  userId: string;
  displayName: string;
  avatarObjectId: string | null;
  score: number;
  sessionSeconds: number;
  achievementsUnlocked: number;
  asOf: string;
} | null;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { value: MvpResult; expiresAt: number }>();

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default defineEventHandler(async (h3): Promise<MvpResult> => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const dayStart = startOfToday();
  const cacheKey = dayStart.toISOString();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Sum today's session seconds per user (durationSeconds is null for
  // still-running sessions — we treat those as zero rather than guessing).
  const sessionRows = await prisma.playSession.groupBy({
    by: ["userId"],
    where: {
      startedAt: { gte: dayStart },
      durationSeconds: { not: null, gt: 0 },
    },
    _sum: { durationSeconds: true },
  });
  const sessionByUser = new Map(
    sessionRows.map((r) => [r.userId, r._sum.durationSeconds ?? 0]),
  );

  // Count today's achievement unlocks per user.
  const unlockRows = await prisma.userAchievement.groupBy({
    by: ["userId"],
    where: { unlockedAt: { gte: dayStart } },
    _count: { _all: true },
  });
  const unlocksByUser = new Map(
    unlockRows.map((r) => [r.userId, r._count._all]),
  );

  // Union of users with any activity today.
  const candidateIds = new Set<string>([
    ...sessionByUser.keys(),
    ...unlocksByUser.keys(),
  ]);

  if (candidateIds.size === 0) {
    const result: MvpResult = null;
    cache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return result;
  }

  // Drop the system user / disabled users up front, then rank.
  const users = await prisma.user.findMany({
    where: {
      id: { in: [...candidateIds] },
      enabled: true,
      username: { not: "system" },
    },
    select: {
      id: true,
      displayName: true,
      username: true,
      profilePictureObjectId: true,
    },
  });

  let best: {
    user: (typeof users)[number];
    score: number;
    sessionSeconds: number;
    achievementsUnlocked: number;
  } | null = null;

  for (const user of users) {
    const sessionSeconds = sessionByUser.get(user.id) ?? 0;
    const achievementsUnlocked = unlocksByUser.get(user.id) ?? 0;
    const score = sessionSeconds + achievementsUnlocked * 600;
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { user, score, sessionSeconds, achievementsUnlocked };
    }
  }

  const result: MvpResult = best
    ? {
        userId: best.user.id,
        displayName: best.user.displayName || best.user.username,
        avatarObjectId: best.user.profilePictureObjectId || null,
        score: best.score,
        sessionSeconds: best.sessionSeconds,
        achievementsUnlocked: best.achievementsUnlocked,
        asOf: new Date().toISOString(),
      }
    : null;

  cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
});
