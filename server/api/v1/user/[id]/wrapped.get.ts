import type { Prisma } from "~/prisma/client/client";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { normalizeWindow, windowSince } from "~/server/internal/wrapped/window";

/**
 * Personal "Wrapped" — one user's game stats over a selectable window
 * (all / year / month / week). Pure read (no orphan-closing side effects like
 * the stats endpoint). Windowed totals come from PlaySession + UserAchievement;
 * a raw window sum can slightly over-count genuinely overlapping sessions, which
 * every windowed aggregator in this codebase accepts.
 */
export default defineEventHandler(async (h3) => {
  const requester = await aclManager.getUserACL(h3, ["read"]);
  if (!requester) throw createError({ statusCode: 403 });

  const idParam = getRouterParam(h3, "id");
  if (!idParam)
    throw createError({ statusCode: 400, statusMessage: "No userId in route." });

  const user = await prisma.user.findFirst({
    where: { OR: [{ id: idParam }, { username: idParam }] },
    select: { id: true, displayName: true, username: true },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  const window = normalizeWindow(getQuery(h3).window);
  const since = windowSince(window);

  const sessionWhere: Prisma.PlaySessionWhereInput = {
    userId: user.id,
    durationSeconds: { not: null, gt: 0 },
    ...(since ? { startedAt: { gte: since } } : {}),
  };
  const achWhere: Prisma.UserAchievementWhereInput = {
    userId: user.id,
    ...(since ? { unlockedAt: { gte: since } } : {}),
  };

  const [agg, perGame, achievementsUnlocked] = await Promise.all([
    prisma.playSession.aggregate({
      where: sessionWhere,
      _sum: { durationSeconds: true },
      _count: { _all: true },
      _max: { durationSeconds: true },
    }),
    prisma.playSession.groupBy({
      by: ["gameId"],
      where: sessionWhere,
      _sum: { durationSeconds: true },
      orderBy: { _sum: { durationSeconds: "desc" } },
    }),
    prisma.userAchievement.count({ where: achWhere }),
  ]);

  const totalSeconds = agg._sum.durationSeconds ?? 0;
  const sessionCount = agg._count._all;

  const games = perGame.length
    ? await prisma.game.findMany({
        where: { id: { in: perGame.map((g) => g.gameId) } },
        select: {
          id: true,
          mName: true,
          mCoverObjectId: true,
          tags: { select: { name: true } },
        },
      })
    : [];
  const gameMap = new Map(games.map((g) => [g.id, g]));

  const topGames = perGame
    .map((r) => {
      const g = gameMap.get(r.gameId);
      if (!g) return null;
      return {
        id: r.gameId,
        mName: g.mName,
        mCoverObjectId: g.mCoverObjectId || null,
        seconds: r._sum.durationSeconds ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 5);

  // Top tags by windowed playtime — a genre proxy (GameTag coverage varies,
  // so this can be sparse; the client hides the card when empty).
  const tagSeconds = new Map<string, number>();
  for (const r of perGame) {
    const g = gameMap.get(r.gameId);
    if (!g) continue;
    const secs = r._sum.durationSeconds ?? 0;
    for (const t of g.tags)
      tagSeconds.set(t.name, (tagSeconds.get(t.name) ?? 0) + secs);
  }
  const topTags = [...tagSeconds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, seconds]) => ({ name, seconds }));

  // Achievement highlights: total points (RA-biased — 0 for Steam titles) and
  // the rarest earned in-window (min globalPercent; null when unknown).
  let points = 0;
  let rarest: {
    title: string;
    globalPercent: number;
    gameName: string | null;
  } | null = null;
  if (achievementsUnlocked > 0) {
    const unlocked = await prisma.userAchievement.findMany({
      where: achWhere,
      select: { achievementId: true },
    });
    const achIds = [...new Set(unlocked.map((u) => u.achievementId))];
    const achs = achIds.length
      ? await prisma.achievement.findMany({
          where: { id: { in: achIds } },
          select: {
            title: true,
            points: true,
            globalPercent: true,
            gameId: true,
          },
        })
      : [];
    let rare: (typeof achs)[number] | null = null;
    for (const a of achs) {
      points += a.points ?? 0;
      if (
        a.globalPercent != null &&
        (!rare || (rare.globalPercent ?? 101) > a.globalPercent)
      )
        rare = a;
    }
    if (rare) {
      const rg =
        gameMap.get(rare.gameId) ??
        (await prisma.game.findUnique({
          where: { id: rare.gameId },
          select: { mName: true },
        }));
      rarest = {
        title: rare.title,
        globalPercent: rare.globalPercent ?? 0,
        gameName: rg?.mName ?? null,
      };
    }
  }

  const top = topGames[0] ?? null;

  return {
    window,
    displayName: user.displayName || user.username,
    totalSeconds,
    sessionCount,
    longestSessionSeconds: agg._max.durationSeconds ?? 0,
    avgSessionSeconds:
      sessionCount > 0 ? Math.round(totalSeconds / sessionCount) : 0,
    achievementsUnlocked,
    points,
    rarest,
    topGames,
    topGame: top
      ? {
          ...top,
          pctOfTotal:
            totalSeconds > 0
              ? Math.round((top.seconds / totalSeconds) * 100)
              : 0,
        }
      : null,
    topTags,
  };
});
