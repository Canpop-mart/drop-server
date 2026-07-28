import aclManager from "~/server/internal/acls";
import { computeGameAchievementsForUser } from "~/server/internal/achievements/gameDetail";

// The CALLER's per-achievement unlock detail for a game (deduped across
// providers, with rarity). Shares its computation with
// `GET /user/{id}/achievements/{gameId}` (another user's set, for comparison)
// via computeGameAchievementsForUser so the two always match.
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  return computeGameAchievementsForUser(userId, gameId);
});
