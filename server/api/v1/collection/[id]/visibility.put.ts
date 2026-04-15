import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Toggle a collection's public visibility.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["collections:add"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(h3);
  const isPublic = body?.isPublic === true;

  const result = await prisma.collection.updateMany({
    where: { id, userId },
    data: { isPublic },
  });

  if (result.count === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });
  }

  return { isPublic };
});
