import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    where: {
      featured: true,
    },
    select: {
      id: true,
      mName: true,
      mShortDescription: true,
      mCoverObjectId: true,
      mBannerObjectId: true,
      updateAvailable: true,
      developers: {
        select: {
          id: true,
          mName: true,
        },
      },
      publishers: {
        select: {
          id: true,
          mName: true,
        },
      },
      tags: {
        select: {
          id: true,
          name: true,
        },
      },
      versions: {
        select: {
          displayName: true,
          versionIndex: true,
        },
        orderBy: {
          versionIndex: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      created: "desc",
    },
  });

  return games;
});
