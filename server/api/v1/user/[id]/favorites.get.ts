import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const requestingUser = await aclManager.getUserACL(h3, ["read"]);
  if (!requestingUser) throw createError({ statusCode: 403 });

  const userId = getRouterParam(h3, "id");
  if (!userId)
    throw createError({
      statusCode: 400,
      statusMessage: "No userId in route.",
    });

  // Resolve user first (supports UUID or username)
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: userId }, { username: userId }],
    },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  const favorites = await prisma.favoriteGame.findMany({
    where: { userId: user.id },
    orderBy: { position: "asc" },
  });

  const gameIds = favorites.map((f) => f.gameId);
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: {
      id: true,
      mName: true,
      mCoverObjectId: true,
      mIconObjectId: true,
    },
  });
  const gameMap = Object.fromEntries(games.map((g) => [g.id, g]));

  return favorites.map((f) => ({
    ...f,
    game: gameMap[f.gameId] ?? null,
  }));
});
