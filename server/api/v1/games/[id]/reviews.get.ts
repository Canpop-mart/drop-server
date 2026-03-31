import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });
  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "Missing game ID" });

  const reviews = await prisma.gameReview.findMany({
    where: { gameId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profilePictureObjectId: true,
        },
      },
    },
  });

  const aggregate = await prisma.gameReview.aggregate({
    where: { gameId },
    _avg: { rating: true },
    _count: true,
  });

  return {
    stats: {
      averageRating: aggregate._avg.rating ?? 0,
      totalReviews: aggregate._count,
    },
    reviews,
  };
});
