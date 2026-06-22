import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { gameSizeManager } from "~/server/internal/gamesize";

/**
 * GET /api/v1/admin/games/biggest-to-download — top games by the download size
 * of their LATEST version (what a user would pull to install it now).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    select: {
      id: true,
      mName: true,
      versions: {
        select: { versionId: true },
        orderBy: { versionIndex: "desc" },
        take: 1,
      },
    },
  });

  // getVersionSize is cached, but on a cold cache each call builds the version's
  // manifest. Run in bounded batches so a fresh server doesn't fan out hundreds
  // of concurrent manifest builds and exhaust the DB connection pool.
  const withVersion = games.filter((g) => g.versions.length > 0);
  const sized: Array<{ gameId: string; gameName: string; size: number }> = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < withVersion.length; i += CONCURRENCY) {
    const batch = withVersion.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (g) => ({
        gameId: g.id,
        gameName: g.mName,
        size:
          (await gameSizeManager.getVersionSize(g.versions[0].versionId))
            ?.downloadSize ?? 0,
      })),
    );
    sized.push(...results);
  }

  return sized
    .filter((g) => g.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((g, i) => ({ rank: i + 1, ...g }));
});
