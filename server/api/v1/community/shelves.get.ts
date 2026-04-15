import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Get all public shelves across all users.
 * Returns shelves with their owner and game entries.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const shelves = await prisma.collection.findMany({
    where: { isPublic: true, isDefault: false },
    select: {
      id: true,
      name: true,
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profilePictureObjectId: true,
        },
      },
      entries: {
        select: {
          gameId: true,
          game: {
            select: {
              id: true,
              mName: true,
              mCoverObjectId: true,
              mIconObjectId: true,
            },
          },
        },
        take: 20,
      },
    },
    orderBy: { name: "asc" },
    take: 50,
  });

  return shelves;
});
