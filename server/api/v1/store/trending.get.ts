import { ArkErrors, type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const TrendingQuery = type({
  take: type("string")
    .pipe((s) => Number.parseInt(s))
    .default("10"),
  days: type("string")
    .pipe((s) => Number.parseInt(s))
    .default("7"),
});

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = TrendingQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: query.summary });

  const limit = Math.min(Math.max(query.take, 1), 25);
  const daysBack = Math.min(Math.max(query.days, 1), 90);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // Find games with the most unique players in recent play sessions
  const trending = await prisma.playSession.groupBy({
    by: ["gameId"],
    where: {
      startedAt: { gte: since },
      game: { type: GameType.Game },
    },
    _count: { userId: true },
    orderBy: { _count: { userId: "desc" } },
    take: limit,
  });

  if (trending.length === 0) {
    return { results: [] };
  }

  const gameIds = trending.map((t) => t.gameId);
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: {
      id: true,
      mName: true,
      mIconObjectId: true,
      mCoverObjectId: true,
      mBannerObjectId: true,
      mShortDescription: true,
      mReleased: true,
      tags: { select: { id: true, name: true } },
      developers: { select: { id: true, mName: true } },
    },
  });

  // Preserve trending order
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const trendingMap = new Map(trending.map((t) => [t.gameId, t._count.userId]));

  return {
    results: gameIds
      .map((id) => {
        const game = gameMap.get(id);
        if (!game) return null;
        return {
          ...game,
          recentPlayers: trendingMap.get(id) ?? 0,
        };
      })
      .filter((g) => g !== null),
  };
});
