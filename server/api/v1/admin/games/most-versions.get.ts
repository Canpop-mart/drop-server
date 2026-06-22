import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * GET /api/v1/admin/games/most-versions — games ranked by how many versions are
 * stored on the server. A single indexed groupBy (no manifest reads).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const grouped = await prisma.gameVersion.groupBy({
    by: ["gameId"],
    _count: { versionId: true },
    orderBy: { _count: { versionId: "desc" } },
    take: 5,
  });

  const gameIds = grouped.map((g) => g.gameId);
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true, mName: true },
  });
  const nameMap = Object.fromEntries(games.map((g) => [g.id, g.mName]));

  return grouped
    .filter((g) => nameMap[g.gameId])
    .map((g, i) => ({
      rank: i + 1,
      gameId: g.gameId,
      gameName: nameMap[g.gameId],
      versionCount: g._count.versionId,
    }));
});
