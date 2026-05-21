import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { scanGame } from "~/server/internal/achievements";
import { resolveRACredentials } from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

/**
 * Back-compat wrapper — bulk-refreshes RetroAchievements definitions for
 * every game that ALREADY has an RA link.
 *
 * BEHAVIOUR CHANGE (2026 achievements audit, see
 * docs/audit/achievements-2026.md): the old version of this endpoint also
 * tried to auto-link unlinked games by searching RA by name. That
 * search-and-link behaviour now lives exclusively in the
 * `link:retroachievements` background task (slow, rate-limited, RA-API
 * heavy). This endpoint only refreshes definitions for linked games so it
 * stays fast and predictable. To auto-link, run the task from the admin
 * task panel or the Bulk tab on the achievements page.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const raCreds = await resolveRACredentials(userId);
  if (!raCreds) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "RetroAchievements not configured. Set RA_USERNAME/RA_API_KEY or link your RA account in Settings.",
    });
  }

  // Only games with an existing RA link — auto-linking is the task's job.
  const linkedGames = await prisma.game.findMany({
    where: {
      externalLinks: { some: { provider: "RetroAchievements" } },
    },
    select: { id: true, mName: true, libraryPath: true },
  });

  logger.info(
    `[ACH:ra] scan-retroachievements (back-compat) — refreshing ${linkedGames.length} linked game(s)`,
  );

  const details: {
    gameId: string;
    gameName: string;
    matched: boolean;
    achievements?: number;
    note?: string;
  }[] = [];

  for (const game of linkedGames) {
    const [outcome] = await scanGame(game.id, ["retroachievements"], {
      userId,
    });
    details.push({
      gameId: game.id,
      gameName: game.mName ?? game.libraryPath,
      matched: !!outcome?.result.linked,
      achievements: outcome?.result.definitionCount,
      note: outcome?.result.note,
    });
  }

  const matched = details.filter((d) => d.matched);
  return {
    gamesScanned: linkedGames.length,
    gamesMatched: matched.length,
    note: "Refreshes linked games only. Run the link:retroachievements task to auto-link new games.",
    details,
  };
});
