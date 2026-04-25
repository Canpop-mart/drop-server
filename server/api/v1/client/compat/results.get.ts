import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Returns this client's latest compat result per game (one row per game,
 * most recent only). Lets the worker skip games it has already tested
 * recently when iterating the library.
 *
 * Implementation: a DISTINCT ON via raw query is the cleanest fit, but
 * Prisma doesn't expose that without going to $queryRaw. The fan-out via
 * findMany + groupBy below is fine for libraries up to a few thousand
 * games.
 */
export default defineClientEventHandler(async (_h3, { clientId }) => {
  const rows = await prisma.gameCompatibilityResult.findMany({
    where: { clientId },
    orderBy: { testedAt: "desc" },
    select: {
      gameId: true,
      status: true,
      signature: true,
      testedAt: true,
    },
  });

  // Keep only the latest row per gameId (rows already sorted desc).
  const latestByGame = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByGame.has(row.gameId)) {
      latestByGame.set(row.gameId, row);
    }
  }

  return {
    results: Array.from(latestByGame.values()),
  };
});
