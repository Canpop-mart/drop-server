import { ArkErrors, type } from "arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const Query = type({
  libraryId: "string",
});

/**
 * Deletes ALL versions for every game in the specified library.
 * Used to bulk-reset games (e.g. ROM libraries) before re-importing.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = Query(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, message: query.summary });

  // Verify library exists
  const library = await prisma.library.findFirst({
    where: { id: query.libraryId },
    select: { id: true, name: true },
  });
  if (!library)
    throw createError({ statusCode: 404, statusMessage: "Library not found" });

  // Get all game IDs in this library
  const games = await prisma.game.findMany({
    where: { libraryId: library.id },
    select: { id: true },
  });
  const gameIds = games.map((g) => g.id);

  if (gameIds.length === 0)
    return { deleted: 0, library: library.name, games: 0 };

  // Delete all versions for all games in this library
  const { count } = await prisma.gameVersion.deleteMany({
    where: { gameId: { in: gameIds } },
  });

  return { deleted: count, library: library.name, games: gameIds.length };
});
