import aclManager from "~/server/internal/acls";
import { getAchievementAvailability } from "~/server/internal/achievements/availability";

/**
 * Why the caller sees no achievements for a game, or can't earn them.
 * Companion to `GET /games/{id}/achievements` (which stays a plain array for
 * its existing consumers). Returns `{ definitionCount, reason,
 * raAccountMissing }`; see server/internal/achievements/availability.ts for
 * what each reason means.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  return getAchievementAvailability(gameId, userId);
});
