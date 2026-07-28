import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { computeGameAchievementsForUser } from "~/server/internal/achievements/gameDetail";

/**
 * GET /api/v1/user/{id}/achievements/{gameId}
 *
 * A SPECIFIC user's per-achievement unlock detail for one game — same shape as
 * `GET /api/v1/games/{id}/achievements`, but for the user named in the route
 * ({id} = UUID or username) rather than the caller. Powers the Steam-style
 * side-by-side achievement comparison.
 *
 * Whole-server visibility: any authenticated user may read any user's
 * achievements (this is a small private instance; the Community tab already
 * exposes everyone's unlock counts). Static sibling `achievements/list` and
 * `achievements/debug/{gameId}` win over this dynamic route in Nitro.
 */
export default defineEventHandler(async (h3) => {
  // Gate: the caller must be an authenticated user of this server.
  const caller = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!caller) throw createError({ statusCode: 403 });

  const idParam = getRouterParam(h3, "id");
  const gameId = getRouterParam(h3, "gameId");
  if (!idParam)
    throw createError({ statusCode: 400, statusMessage: "No user id." });
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game id." });

  // Resolve the target by UUID or username (mirrors the other /user/[id]/* routes).
  const target = await prisma.user.findFirst({
    where: { OR: [{ id: idParam }, { username: idParam }] },
    select: { id: true },
  });
  if (!target)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  return computeGameAchievementsForUser(target.id, gameId);
});
