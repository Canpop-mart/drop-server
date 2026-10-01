import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { MAX_FAVORITES } from "~/server/internal/userprofile/limits";

const AddFavorite = type({
  gameId: "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["profile:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, AddFavorite);

  // Check game exists
  const game = await prisma.game.findUnique({ where: { id: body.gameId } });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  // Same cap as favorites.put.ts. Re-adding a game that is already a
  // favourite is a no-op, so it is allowed at the cap.
  const [count, existing] = await Promise.all([
    prisma.favoriteGame.count({ where: { userId } }),
    prisma.favoriteGame.findUnique({
      where: { userId_gameId: { userId, gameId: body.gameId } },
      select: { id: true },
    }),
  ]);
  if (!existing && count >= MAX_FAVORITES) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximum ${MAX_FAVORITES} favorite games allowed.`,
    });
  }

  // Get next position
  const maxPos = await prisma.favoriteGame.findFirst({
    where: { userId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const favorite = await prisma.favoriteGame.upsert({
    where: { userId_gameId: { userId, gameId: body.gameId } },
    create: {
      userId,
      gameId: body.gameId,
      position: (maxPos?.position ?? -1) + 1,
    },
    update: {},
  });

  return favorite;
});
