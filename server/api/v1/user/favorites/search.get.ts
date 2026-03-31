import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const q = (query.q as string) || "";

  const games = await prisma.game.findMany({
    where: {
      mName: { contains: q, mode: "insensitive" },
    },
    select: {
      id: true,
      mName: true,
      mCoverObjectId: true,
      mIconObjectId: true,
    },
    take: 20,
  });

  // Mark which ones are already favorites
  const favoriteGameIds = await prisma.favoriteGame.findMany({
    where: { userId, gameId: { in: games.map((g) => g.id) } },
    select: { gameId: true },
  });
  const favSet = new Set(favoriteGameIds.map((f) => f.gameId));

  return games.map((g) => ({
    ...g,
    isFavorite: favSet.has(g.id),
  }));
});
