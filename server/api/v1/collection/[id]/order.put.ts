import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const ReorderBody = type({ gameIds: "string[]" }).configure(throwingArktype);

/**
 * Set the curated order of a collection's games. Body is the full list of
 * gameIds in the desired order; each entry's sortIndex becomes its position.
 * Owner-scoped. Ids not in the collection are no-ops.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["collections:add"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const owned = await prisma.collection.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });

  const body = await readDropValidatedBody(h3, ReorderBody);

  await prisma.$transaction(
    body.gameIds.map((gameId, index) =>
      prisma.collectionEntry.updateMany({
        where: { collectionId: id, gameId },
        data: { sortIndex: index },
      }),
    ),
  );
  return { ok: true };
});
