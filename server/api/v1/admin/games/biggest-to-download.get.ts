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

  const sized = await Promise.all(
    games
      .filter((g) => g.versions.length > 0)
      .map(async (g) => ({
        gameId: g.id,
        gameName: g.mName,
        size:
          (await gameSizeManager.getVersionSize(g.versions[0].versionId))
            ?.downloadSize ?? 0,
      })),
  );

  return sized
    .filter((g) => g.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((g, i) => ({ rank: i + 1, ...g }));
});
