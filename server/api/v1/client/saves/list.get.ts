import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  collapseByFilename,
  isReadableSave,
  readableSaveScope,
} from "~/server/internal/cloudsaves/scope";

/**
 * List cloud saves for a game. Returns metadata only (no binary data).
 * Query: ?gameId=xxx
 *
 * Same read scope as sync-check: the caller's own saves only
 * (`internal/cloudsaves/scope.ts`). `ownedBy`, `shadowedSaveId` and
 * `alsoHeldBy` are kept in the response for older clients; with per-user reads
 * they are always the caller's name, null and empty.
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
    where: { gameId, deletedAt: null, ...readableSaveScope(userId) },
    select: {
      id: true,
      userId: true,
      user: { select: { displayName: true } },
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

  // Belt and braces: the query is already scoped to the caller.
  const readable = saves.filter((s) => isReadableSave(s, userId));

  // One row per filename already (the scope is one account); the collapse
  // only shapes the response.
  return collapseByFilename(readable, userId)
    .sort(
      (a, b) =>
        b.winner.clientModifiedAt.getTime() -
        a.winner.clientModifiedAt.getTime(),
    )
    .map(({ winner, shadowedOwn, alsoHeldBy }) => ({
      id: winner.id,
      filename: winner.filename,
      saveType: winner.saveType,
      size: winner.size,
      dataHash: winner.dataHash,
      uploadedFrom: winner.uploadedFrom,
      clientModifiedAt: winner.clientModifiedAt,
      uploadedAt: winner.uploadedAt,
      ownedBy: winner.user.displayName,
      shadowedSaveId: shadowedOwn?.id ?? null,
      alsoHeldBy,
    }));
});
