import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Backfills mImageCarouselObjectIds for games that have images in their
 * library but an empty carousel. Skips the first image (cover) and takes
 * up to 10 artworks/screenshots.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    where: {
      mImageCarouselObjectIds: { isEmpty: true },
      NOT: { mImageLibraryObjectIds: { isEmpty: true } },
    },
    select: { id: true, mImageLibraryObjectIds: true },
  });

  let updated = 0;
  for (const game of games) {
    // Skip cover (index 0), take up to 10 artworks/screenshots
    const carouselIds = game.mImageLibraryObjectIds.slice(1, 11);
    if (carouselIds.length === 0) continue;

    const result = await prisma.game.updateMany({
      where: { id: game.id },
      data: { mImageCarouselObjectIds: carouselIds },
    });
    if (result.count > 0) updated++;
  }

  return { updated, total: games.length };
});
