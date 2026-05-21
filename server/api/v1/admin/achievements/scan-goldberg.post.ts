import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { scanGame } from "~/server/internal/achievements";
import { logger } from "~/server/internal/logging";

/**
 * Back-compat wrapper — bulk-scans every game for Goldberg achievements.
 *
 * The 2026 achievements audit consolidated scanning into a single
 * orchestrator; this route is kept as a thin shim over
 * `POST /api/v1/admin/achievements/scan` with `provider=goldberg` and no
 * `gameId` (bulk). New callers should use the canonical endpoint
 * directly. See docs/audit/achievements-2026.md.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  logger.info("[ACH:goldberg] scan-goldberg (back-compat) — bulk scan");

  const games = await prisma.game.findMany({
    select: { id: true, mName: true, libraryPath: true },
  });

  const details: {
    gameId: string;
    gameName: string;
    appId: string;
    achievements: number;
  }[] = [];

  for (const game of games) {
    const [outcome] = await scanGame(game.id, ["goldberg"], { userId });
    if (!outcome || !outcome.result.linked) continue;
    details.push({
      gameId: game.id,
      gameName: game.mName ?? game.libraryPath,
      appId: outcome.result.externalGameId ?? "",
      achievements: outcome.result.definitionCount,
    });
  }

  return {
    gamesScanned: games.length,
    gamesWithGoldberg: details.length,
    details,
  };
});
