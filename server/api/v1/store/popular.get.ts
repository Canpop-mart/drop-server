import { ArkErrors, type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const PopularQuery = type({
  take: type("string")
    .pipe((s) => Number.parseInt(s))
    .default("10"),
});

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = PopularQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: query.summary });

  const limit = Math.min(Math.max(query.take, 1), 25);

  // Aggregate total playtime across all users per game
  const popular = await prisma.playtime.groupBy({
    by: ["gameId"],
    _sum: { seconds: true },
    _count: { userId: true },
    orderBy: { _sum: { seconds: "desc" } },
    take: limit * 2, // fetch extra to filter out non-Game types
  });

  if (popular.length === 0) {
    return { results: [] };
  }

  const gameIds = popular.map((p) => p.gameId);
  const games = await prisma.game.findMany({
    where: {
      id: { in: gameIds },
      type: GameType.Game,
    },
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

  // Preserve popularity order, filter to Game type only
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const statsMap = new Map(
    popular.map((p) => [
      p.gameId,
      {
        totalPlaytimeHours: Math.round((p._sum.seconds ?? 0) / 3600),
        playerCount: p._count.userId,
      },
    ]),
  );

  return {
    results: gameIds
      .map((id) => {
        const game = gameMap.get(id);
        if (!game) return null;
        const stats = statsMap.get(id);
        return {
          ...game,
          totalPlaytimeHours: stats?.totalPlaytimeHours ?? 0,
          playerCount: stats?.playerCount ?? 0,
        };
      })
      .filter((g) => g !== null)
      .slice(0, limit),
  };
});
