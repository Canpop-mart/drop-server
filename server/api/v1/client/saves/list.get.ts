import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * List cloud saves for a game. Returns metadata only (no binary data).
 * Query: ?gameId=xxx
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getQuery(h3).gameId as string;
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "gameId required" });

  const saves = await prisma.cloudSave.findMany({
    where: { gameId, userId },
    select: {
      id: true,
      filename: true,
      saveType: true,
      size: true,
      dataHash: true,
      uploadedFrom: true,
      clientModifiedAt: true,
      uploadedAt: true,
    },
    orderBy: { clientModifiedAt: "desc" },
  });

  return saves;
});
