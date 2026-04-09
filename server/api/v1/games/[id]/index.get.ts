import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import gameSizeManager from "~/server/internal/gamesize";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing gameId in route params (somehow...?)",
    });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      versions: {
        include: {
          launches: true,
          setups: true,
        },
        omit: {
          dropletManifest: true,
        },
        orderBy: {
          versionIndex: "desc",
        },
      },
      publishers: {
        select: {
          id: true,
          mName: true,
          mShortDescription: true,
          mLogoObjectId: true,
        },
      },
      developers: {
        select: {
          id: true,
          mName: true,
          mShortDescription: true,
          mLogoObjectId: true,
        },
      },
      tags: true,
    },
  });

  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  const rating = await prisma.gameRating.aggregate({
    where: {
      gameId: game.id,
    },
    _avg: {
      mReviewRating: true,
    },
    _sum: {
      mReviewCount: true,
    },
  });

  const sizesRaw = await Promise.all(
    game.versions!.map(async (v) => {
      try {
        return await gameSizeManager.getVersionSize(v.versionId);
      } catch {
        return null;
      }
    }),
  );
  const sizes = sizesRaw.filter((s): s is NonNullable<typeof s> => s !== null);

  const platforms = new Set(
    game
      .versions!.map((v) => [
        ...v.setups.map((v) => v.platform),
        ...v.launches.map((v) => v.platform),
      ])
      .flat(),
  );

  const gameV: Omit<typeof game, "versions"> = game;

  // @ts-expect-error value exists at runtime
  delete gameV.versions;

  return {
    game: gameV,
    rating,
    sizes,
    platforms: platforms.values().toArray(),
  };
});
