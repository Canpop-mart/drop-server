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

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  const showcases = await prisma.profileShowcase.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    take: 6,
    select: {
      id: true,
      type: true,
      gameId: true,
      itemId: true,
      title: true,
      data: true,
      sortOrder: true,
    },
  });

  // Batch-fetch related games
  const gameIds = [
    ...new Set(showcases.map((s) => s.gameId).filter(Boolean)),
  ] as string[];
  const games =
    gameIds.length > 0
      ? await prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: {
            id: true,
            mName: true,
            mIconObjectId: true,
            mCoverObjectId: true,
            mBannerObjectId: true,
          },
        })
      : [];
  const gameMap = Object.fromEntries(games.map((g) => [g.id, g]));

  return {
    items: showcases.map((s) => ({
      ...s,
      game: s.gameId ? (gameMap[s.gameId] ?? null) : null,
    })),
  };
});
