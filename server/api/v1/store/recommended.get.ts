import { ArkErrors, type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const RecommendedQuery = type({
  take: type("string")
    .pipe((s) => Number.parseInt(s))
    .default("10"),
});

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = RecommendedQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: query.summary });

  const limit = Math.min(Math.max(query.take, 1), 25);

  // The user's most-played games, to derive their preferred tags
  const userPlaytime = await prisma.playtime.findMany({
    where: { userId },
    orderBy: { seconds: "desc" },
    take: 20,
    select: { gameId: true },
  });

  // Owned (collection) games, to exclude them from results
  const userCollections = await prisma.collectionEntry.findMany({
    where: { collection: { userId } },
    select: { gameId: true },
  });
  const ownedGameIds = new Set(userCollections.map((c) => c.gameId));
  const playedGameIds = userPlaytime.map((p) => p.gameId);

  const playedGames = await prisma.game.findMany({
    where: { id: { in: playedGameIds } },
    select: {
      tags: { select: { id: true } },
    },
  });

  const tagFrequency = new Map<string, number>();
  for (const game of playedGames) {
    for (const tag of game.tags) {
      tagFrequency.set(tag.id, (tagFrequency.get(tag.id) ?? 0) + 1);
    }
  }

  // Find unowned games that share the user's most common tags
  const topTagIds = [...tagFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  if (topTagIds.length === 0) {
    // Fallback: return recently added games the user doesn't own
    const recentGames = await prisma.game.findMany({
      where: {
        type: GameType.Game,
        id: { notIn: [...ownedGameIds] },
      },
      orderBy: { created: "desc" },
      take: limit,
      select: {
        id: true,
        mName: true,
        mIconObjectId: true,
        mCoverObjectId: true,
        mBannerObjectId: true,
        mShortDescription: true,
        mReleased: true,
        tags: { select: { id: true, name: true } },
        developers: { select: { id: true, mName: true } },
      },
    });
    return { results: recentGames, reason: "recent" };
  }

  // Find games matching user's top tags, excluding owned games
  const recommended = await prisma.game.findMany({
    where: {
      type: GameType.Game,
      id: { notIn: [...ownedGameIds] },
      tags: {
        some: {
          id: { in: topTagIds },
        },
      },
    },
    orderBy: { mReleased: "desc" },
    take: limit,
    select: {
      id: true,
      mName: true,
      mIconObjectId: true,
      mCoverObjectId: true,
      mBannerObjectId: true,
      mShortDescription: true,
      mReleased: true,
      tags: { select: { id: true, name: true } },
      developers: { select: { id: true, mName: true } },
    },
  });

  return { results: recommended, reason: "tags" };
});
