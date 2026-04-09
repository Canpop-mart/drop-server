import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

/**
 * Returns list of game IDs that have a RetroAchievements external link.
 * Used for filtering "unlinked games" on the admin achievements page.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const links = await prisma.gameExternalLink.findMany({
    where: { provider: ExternalAccountProvider.RetroAchievements },
    select: { gameId: true },
  });

  return links.map((l) => l.gameId);
});
