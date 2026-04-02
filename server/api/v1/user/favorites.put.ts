import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const MAX_FAVORITES = 10;

const FavoritesBody = type({
  gameIds: "string[]",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, FavoritesBody);

  if (body.gameIds.length > MAX_FAVORITES) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximum ${MAX_FAVORITES} favorite games allowed.`,
    });
  }

  // Validate all games exist
  const uniqueIds = [...new Set(body.gameIds)];
  if (uniqueIds.length > 0) {
    const existing = await prisma.game.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    const existingSet = new Set(existing.map((g) => g.id));
    for (const gid of uniqueIds) {
      if (!existingSet.has(gid)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Game ${gid} does not exist.`,
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.favoriteGame.deleteMany({ where: { userId } });
    if (uniqueIds.length > 0) {
      await tx.favoriteGame.createMany({
        data: uniqueIds.map((gameId, idx) => ({
          userId,
          gameId,
          position: idx,
        })),
      });
    }
  });

  return { count: uniqueIds.length };
});
