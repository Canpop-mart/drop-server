import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { gameSizeManager } from "~/server/internal/gamesize";

/**
 * GET /api/v1/admin/games/biggest-on-server — top games by total disk footprint
 * across ALL stored versions (what the server is actually holding).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    select: { id: true, mName: true },
  });

  const sized = await Promise.all(
    games.map(async (g) => ({
      gameId: g.id,
      gameName: g.mName,
      size: await gameSizeManager.getGameDiskSize(g.id),
    })),
  );

  return sized
    .filter((g) => g.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((g, i) => ({ rank: i + 1, ...g }));
});
