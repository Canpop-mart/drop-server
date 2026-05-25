import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * List cloud saves for a game. Returns metadata only (no binary data).
 * Query: ?gameId=xxx
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const gameId = getQuery(h3).gameId as string;
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "gameId required" });

  // Hide tombstones from the listing — `delete.post.ts` soft-deletes by
  // setting `deletedAt`, and listings should reflect what the user thinks of
  // as "their saves". Cross-device delete cascading runs through sync-check's
  // `tombstones` array, not this endpoint.
  const saves = await prisma.cloudSave.findMany({
    where: { gameId, userId, deletedAt: null },
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
