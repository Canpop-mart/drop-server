import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Drop Time Machine — a rotating "this day in history" event.
 *
 * For each anniversary level (30, 90, 180, 365 days ago) we look at events
 * that happened on that calendar day and gather three candidate kinds:
 *
 *  - anniversary_session     a play session on that day (prefers multi-hour)
 *  - anniversary_first_play  a user's first-ever session of a game on that day
 *  - anniversary_unlock      an achievement unlock on that day
 *
 * Picking strategy: walk levels older → newer (365, 180, 90, 30) and stop
 * at the first level that has any candidates. From that level's pool we
 * pick one uniformly at random — across kinds.
 *
 * For sessions we bias toward longer ones by re-rolling shorter sessions
 * with lower probability (sessions < 1h get weight 1; 1–3h weight 3;
 * 3h+ weight 6). This keeps the result varied but tilts toward the
 * memorable marathons.
 *
 * Returns null if no eligible events exist at any level.
 */

type TimeMachineEvent = {
  kind: "anniversary_session" | "anniversary_first_play" | "anniversary_unlock";
  daysAgo: number;
  user: { id: string; displayName: string; avatarObjectId: string | null };
  game: { id: string; name: string; coverObjectId: string | null };
  detail: string;
} | null;

const LEVELS = [365, 180, 90, 30] as const;
// ±12h window around the anniversary instant. Sessions/unlocks land in
// continuous time but a single "day" matches what the UI implies.
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 1) {
    return `${Math.round(hours)} hour session`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute session`;
}

function sessionWeight(seconds: number): number {
  const hours = seconds / 3600;
  if (hours >= 3) return 6;
  if (hours >= 1) return 3;
  return 1;
}

export default defineEventHandler(async (h3): Promise<TimeMachineEvent> => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  type Candidate =
    | {
        kind: "anniversary_session";
        daysAgo: number;
        userId: string;
        gameId: string;
        seconds: number;
        weight: number;
      }
    | {
        kind: "anniversary_first_play";
        daysAgo: number;
        userId: string;
        gameId: string;
        weight: number;
      }
    | {
        kind: "anniversary_unlock";
        daysAgo: number;
        userId: string;
        gameId: string;
        achievementId: string;
        weight: number;
      };

  for (const daysAgo of LEVELS) {
    const anchor = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    const windowStart = new Date(anchor - HALF_DAY_MS);
    const windowEnd = new Date(anchor + HALF_DAY_MS);

    // Pull all sessions in the anniversary window. Only finished sessions
    // with a positive duration are interesting; still-running ones from a
    // year ago shouldn't exist, but guard anyway.
    const sessions = await prisma.playSession.findMany({
      where: {
        startedAt: { gte: windowStart, lte: windowEnd },
        durationSeconds: { not: null, gt: 0 },
      },
      select: {
        userId: true,
        gameId: true,
        startedAt: true,
        durationSeconds: true,
      },
    });

    const unlocks = await prisma.userAchievement.findMany({
      where: { unlockedAt: { gte: windowStart, lte: windowEnd } },
      select: {
        userId: true,
        achievementId: true,
        achievement: { select: { gameId: true } },
      },
    });

    if (sessions.length === 0 && unlocks.length === 0) continue;

    const candidates: Candidate[] = [];

    // ── Sessions: each session is its own "anniversary_session" candidate.
    for (const s of sessions) {
      const sec = s.durationSeconds ?? 0;
      candidates.push({
        kind: "anniversary_session",
        daysAgo,
        userId: s.userId,
        gameId: s.gameId,
        seconds: sec,
        weight: sessionWeight(sec),
      });
    }

    // ── Anniversary first-plays: for each (user, game) seen in today's
    // sessions, check if any session of theirs for that game existed
    // strictly *before* the window start. If not, that's a first-play on
    // this anniversary.
    const userGamePairs = new Map<string, { userId: string; gameId: string }>();
    for (const s of sessions) {
      const key = `${s.userId}:${s.gameId}`;
      if (!userGamePairs.has(key)) {
        userGamePairs.set(key, { userId: s.userId, gameId: s.gameId });
      }
    }
    if (userGamePairs.size > 0) {
      const pairKeys = [...userGamePairs.values()];
      // Batch-fetch any earlier sessions for any of these (userId, gameId)
      // pairs in one query, then mark which pairs had none.
      const earlier = await prisma.playSession.findMany({
        where: {
          startedAt: { lt: windowStart },
          OR: pairKeys.map((p) => ({ userId: p.userId, gameId: p.gameId })),
        },
        select: { userId: true, gameId: true },
        distinct: ["userId", "gameId"],
      });
      const veterans = new Set(earlier.map((e) => `${e.userId}:${e.gameId}`));
      for (const [key, pair] of userGamePairs) {
        if (!veterans.has(key)) {
          candidates.push({
            kind: "anniversary_first_play",
            daysAgo,
            userId: pair.userId,
            gameId: pair.gameId,
            // First-plays are inherently interesting → weight 4.
            weight: 4,
          });
        }
      }
    }

    // ── Unlocks
    for (const u of unlocks) {
      if (!u.achievement?.gameId) continue;
      candidates.push({
        kind: "anniversary_unlock",
        daysAgo,
        userId: u.userId,
        gameId: u.achievement.gameId,
        achievementId: u.achievementId,
        weight: 2,
      });
    }

    if (candidates.length === 0) continue;

    // Filter candidates by users + games that resolve and aren't the
    // system user before picking — otherwise we might roll a dud and
    // return null when other choices exist.
    const referencedUserIds = new Set(candidates.map((c) => c.userId));
    const referencedGameIds = new Set(candidates.map((c) => c.gameId));
    const referencedAchievementIds = new Set(
      candidates
        .filter(
          (c): c is Extract<Candidate, { kind: "anniversary_unlock" }> =>
            c.kind === "anniversary_unlock",
        )
        .map((c) => c.achievementId),
    );

    const [users, games, achievements] = await Promise.all([
      prisma.user.findMany({
        where: {
          id: { in: [...referencedUserIds] },
          enabled: true,
          username: { not: "system" },
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          profilePictureObjectId: true,
        },
      }),
      prisma.game.findMany({
        where: { id: { in: [...referencedGameIds] } },
        select: { id: true, mName: true, mCoverObjectId: true },
      }),
      referencedAchievementIds.size > 0
        ? prisma.achievement.findMany({
            where: { id: { in: [...referencedAchievementIds] } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as { id: string; title: string }[]),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const gameMap = new Map(games.map((g) => [g.id, g]));
    const achievementMap = new Map(achievements.map((a) => [a.id, a]));

    const usable = candidates.filter((c) => {
      if (!userMap.has(c.userId)) return false;
      if (!gameMap.has(c.gameId)) return false;
      if (
        c.kind === "anniversary_unlock" &&
        !achievementMap.has(c.achievementId)
      )
        return false;
      return true;
    });
    if (usable.length === 0) continue;

    // Weighted random pick.
    const totalWeight = usable.reduce((acc, c) => acc + c.weight, 0);
    let roll = Math.random() * totalWeight;
    let picked = usable[0];
    for (const c of usable) {
      roll -= c.weight;
      if (roll <= 0) {
        picked = c;
        break;
      }
    }

    const user = userMap.get(picked.userId)!;
    const game = gameMap.get(picked.gameId)!;

    let detail: string;
    if (picked.kind === "anniversary_session") {
      detail = formatHours(picked.seconds);
    } else if (picked.kind === "anniversary_first_play") {
      detail = "first played";
    } else {
      const ach = achievementMap.get(picked.achievementId);
      detail = ach ? `unlocked ${ach.title}` : "unlocked an achievement";
    }

    return {
      kind: picked.kind,
      daysAgo: picked.daysAgo,
      user: {
        id: user.id,
        displayName: user.displayName || user.username,
        avatarObjectId: user.profilePictureObjectId || null,
      },
      game: {
        id: game.id,
        name: game.mName,
        coverObjectId: game.mCoverObjectId || null,
      },
      detail,
    };
  }

  return null;
});
