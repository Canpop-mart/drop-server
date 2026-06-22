import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Aggregate total playtime per game across every user, all time. Playtime
  // rows are keyed by (gameId, userId), so the row count per group is the
  // number of distinct players for that game.
  const byGame = await prisma.playtime.groupBy({
    by: ["gameId"],
    _sum: { seconds: true },
    _count: true,
    orderBy: { _sum: { seconds: "desc" } },
    take: 10,
  });

  const gameIds = byGame.map((g) => g.gameId);
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true, mName: true, mIconObjectId: true },
  });
  const gameMap = Object.fromEntries(games.map((g) => [g.id, g]));

  return byGame
    .filter((g) => gameMap[g.gameId])
    .map((g, i) => ({
      rank: i + 1,
      game: gameMap[g.gameId],
      playtimeHours: Math.round((g._sum.seconds ?? 0) / 3600),
      players: g._count,
    }));
});
