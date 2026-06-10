import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Public store-collection landing data: the collection's metadata plus its
 * games in curated order. Resolves any *public* collection (regardless of the
 * featured flag — a public-but-unfeatured collection is still shareable by
 * link, it just isn't on the store-home shelf).
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "ID required" });

  const collection = await prisma.collection.findFirst({
    where: { id, isPublic: true },
    select: {
      id: true,
      name: true,
      description: true,
      coverObjectId: true,
      entries: {
        orderBy: { sortIndex: "asc" },
        select: {
          game: {
            select: {
              id: true,
              mName: true,
              mShortDescription: true,
              mCoverObjectId: true,
              mBannerObjectId: true,
              mIconObjectId: true,
            },
          },
        },
      },
    },
  });

  if (!collection)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });

  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    coverObjectId: collection.coverObjectId,
    games: collection.entries.map((e) => e.game),
  };
});
