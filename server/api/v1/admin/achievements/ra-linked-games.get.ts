import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Returns list of game IDs that have ANY external link (Goldberg, RetroAchievements, etc.).
 * Used for filtering "unlinked games" on the admin achievements page.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const links = await prisma.gameExternalLink.findMany({
    select: { gameId: true },
    distinct: ["gameId"],
  });

  return links.map((l) => l.gameId);
});
