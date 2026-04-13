import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Get the 8 most recently played games for the authenticated user.
 * Returns one entry per game (the most recent session for each game).
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  // Query PlaySession for the user, grouped by gameId (taking the latest per game),
  // ordered by startedAt DESC, limited to 8 results.
  // Then join with Game data to get name and cover.
  const sessions = await prisma.playSession.findMany({
    where: {
      userId: user.id,
    },
    distinct: ["gameId"],
    orderBy: {
      startedAt: "desc",
    },
    take: 8,
    include: {
      game: {
        select: {
          id: true,
          mName: true,
          mCoverObjectId: true,
        },
      },
    },
  });

  // For each game, also fetch the cumulative playtime record
  const playtimes = await prisma.playtime.findMany({
    where: {
      userId: user.id,
      gameId: {
        in: sessions.map((s) => s.gameId),
      },
    },
    select: {
      gameId: true,
      seconds: true,
    },
  });

  // Create a map for quick lookup
  const playtimeMap = new Map(playtimes.map((p) => [p.gameId, p.seconds]));

  // Format the response
  const result = sessions.map((session) => ({
    gameId: session.gameId,
    gameName: session.game.mName,
    coverObjectId: session.game.mCoverObjectId,
    lastPlayedAt: session.startedAt,
    totalPlaytimeSeconds: playtimeMap.get(session.gameId) || 0,
  }));

  return result;
});
