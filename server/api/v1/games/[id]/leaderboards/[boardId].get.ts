import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  const boardId = getRouterParam(h3, "boardId");
  if (!gameId || !boardId)
    throw createError({ statusCode: 400, statusMessage: "Missing params." });

  const leaderboard = await prisma.leaderboard.findUnique({
    where: { id: boardId },
  });
  if (!leaderboard || leaderboard.gameId !== gameId)
    throw createError({
      statusCode: 404,
      statusMessage: "Leaderboard not found.",
    });

  const entries = await prisma.leaderboardEntry.findMany({
    where: { leaderboardId: boardId },
    orderBy: { rank: "asc" },
    take: 50,
    select: {
      id: true,
      score: true,
      rank: true,
      submittedAt: true,
      data: true,
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

  // Find current user's entry
  const userEntry = await prisma.leaderboardEntry.findUnique({
    where: { leaderboardId_userId: { leaderboardId: boardId, userId } },
    select: { score: true, rank: true, submittedAt: true },
  });

  return {
    id: leaderboard.id,
    name: leaderboard.name,
    type: leaderboard.type,
    sortOrder: leaderboard.sortOrder,
    entries,
    userEntry: userEntry ?? null,
  };
});
