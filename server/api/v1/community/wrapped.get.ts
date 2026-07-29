import type { Prisma } from "~/prisma/client/client";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { normalizeWindow, windowSince } from "~/server/internal/wrapped/window";

/**
 * Community "Wrapped" — server-wide game stats over a selectable window
 * (all / year / month / week). Same windowing as the personal wrapped, but
 * across every (non-system) player. Pure read.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const window = normalizeWindow(getQuery(h3).window);
  const since = windowSince(window);

  const sessionWhere: Prisma.PlaySessionWhereInput = {
    durationSeconds: { not: null, gt: 0 },
    ...(since ? { startedAt: { gte: since } } : {}),
  };
  const achWhere: Prisma.UserAchievementWhereInput = since
    ? { unlockedAt: { gte: since } }
    : {};

  const [agg, gu, achievementsUnlocked] = await Promise.all([
    prisma.playSession.aggregate({
      where: sessionWhere,
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
    // (game, user) rows give per-game totals + distinct players AND per-player
    // totals in one pass.
    prisma.playSession.groupBy({
      by: ["gameId", "userId"],
      where: sessionWhere,
      _sum: { durationSeconds: true },
    }),
    prisma.userAchievement.count({ where: achWhere }),
  ]);

  const gameSeconds = new Map<string, number>();
  const gamePlayers = new Map<string, Set<string>>();
  const playerSeconds = new Map<string, number>();
  for (const r of gu) {
    const secs = r._sum.durationSeconds ?? 0;
    gameSeconds.set(r.gameId, (gameSeconds.get(r.gameId) ?? 0) + secs);
    if (!gamePlayers.has(r.gameId)) gamePlayers.set(r.gameId, new Set());
    gamePlayers.get(r.gameId)!.add(r.userId);
    playerSeconds.set(r.userId, (playerSeconds.get(r.userId) ?? 0) + secs);
  }

  const userIds = [...playerSeconds.keys()];
  const gameIds = [...gameSeconds.keys()];
  const [users, games] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: {
            id: { in: userIds },
            enabled: true,
            username: { not: "system" },
          },
          select: {
            id: true,
            displayName: true,
            username: true,
            profilePictureObjectId: true,
          },
        })
      : [],
    gameIds.length
      ? prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: { id: true, mName: true, mCoverObjectId: true },
        })
      : [],
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const gameMap = new Map(games.map((g) => [g.id, g]));

  const topGames = [...gameSeconds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, seconds]) => {
      const g = gameMap.get(id);
      if (!g) return null;
      return {
        id,
        mName: g.mName,
        mCoverObjectId: g.mCoverObjectId || null,
        seconds,
        players: gamePlayers.get(id)?.size ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 6);

  let topPlayer: {
    userId: string;
    displayName: string;
    avatarObjectId: string | null;
    seconds: number;
  } | null = null;
  for (const [uid, secs] of playerSeconds) {
    const u = userMap.get(uid);
    if (!u) continue;
    if (!topPlayer || secs > topPlayer.seconds)
      topPlayer = {
        userId: uid,
        displayName: u.displayName || u.username,
        avatarObjectId: u.profilePictureObjectId || null,
        seconds: secs,
      };
  }

  // New players — first-ever session inside the window (only meaningful when
  // the window is bounded; all-time has no "before").
  let newPlayers = 0;
  if (since && userIds.length) {
    const veterans = await prisma.playSession.findMany({
      where: { userId: { in: userIds }, startedAt: { lt: since } },
      select: { userId: true },
      distinct: ["userId"],
    });
    const vet = new Set(veterans.map((v) => v.userId));
    newPlayers = users.filter((u) => !vet.has(u.id)).length;
  }

  // Rarest achievement earned in-window server-wide + who earned it.
  let rarest: {
    title: string;
    globalPercent: number;
    userDisplayName: string | null;
    gameName: string | null;
  } | null = null;
  if (achievementsUnlocked > 0) {
    const winUnlocks = await prisma.userAchievement.findMany({
      where: achWhere,
      select: { achievementId: true, userId: true },
    });
    const achIds = [...new Set(winUnlocks.map((u) => u.achievementId))];
    const achs = achIds.length
      ? await prisma.achievement.findMany({
          where: { id: { in: achIds }, globalPercent: { not: null } },
          select: { id: true, title: true, globalPercent: true, gameId: true },
        })
      : [];
    let rare: (typeof achs)[number] | null = null;
    for (const a of achs) {
      if (
        a.globalPercent != null &&
        (!rare || (rare.globalPercent ?? 101) > a.globalPercent)
      )
        rare = a;
    }
    if (rare) {
      const rareId = rare.id;
      const who = winUnlocks.find((u) => u.achievementId === rareId);
      const whoUser = who ? userMap.get(who.userId) : undefined;
      const rg =
        gameMap.get(rare.gameId) ??
        (await prisma.game.findUnique({
          where: { id: rare.gameId },
          select: { mName: true },
        }));
      rarest = {
        title: rare.title,
        globalPercent: rare.globalPercent ?? 0,
        userDisplayName: whoUser
          ? whoUser.displayName || whoUser.username
          : null,
        gameName: rg?.mName ?? null,
      };
    }
  }

  return {
    window,
    totalSeconds: agg._sum.durationSeconds ?? 0,
    sessionCount: agg._count._all,
    playerCount: users.length,
    achievementsUnlocked,
    topGames,
    topGame: topGames[0] ?? null,
    topPlayer,
    rarest,
    newPlayers,
  };
});
