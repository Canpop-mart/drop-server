import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const links = await prisma.gameExternalLink.findMany({
    where: { gameId },
  });

  const achievementCounts = await prisma.achievement.groupBy({
    by: ["provider"],
    where: { gameId },
    _count: true,
  });

  return links.map((link) => ({
    ...link,
    achievementCount:
      achievementCounts.find((c) => c.provider === link.provider)?._count ?? 0,
  }));
});
