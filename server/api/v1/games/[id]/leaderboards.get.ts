import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No gameId." });

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  const leaderboards = await prisma.leaderboard.findMany({
    where: { gameId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      sortOrder: true,
      createdAt: true,
      _count: { select: { entries: true } },
    },
  });

  return leaderboards.map((lb) => ({
    id: lb.id,
    name: lb.name,
    type: lb.type,
    sortOrder: lb.sortOrder,
    createdAt: lb.createdAt,
    entryCount: lb._count.entries,
  }));
});
