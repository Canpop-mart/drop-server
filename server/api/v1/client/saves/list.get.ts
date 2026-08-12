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
 * Same read scope as sync-check: your own saves, plus every account's
 * namespaced PC saves (`internal/cloudsaves/scope.ts`). Each row carries
 * `ownedBy`, the display name of the account it belongs to, so the panel can
 * say whose copy won when two accounts hold the same filename.
 *
 * A collision never hides the caller's own row. It comes back as
 * `shadowedSaveId` on the winner, which is the handle the panel needs to reach
 * that row's revision history, and `alsoHeldBy` names the other accounts so a
 * second copy of a save is never silently invisible.
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

  // The namespace gate the Prisma query can't express: a foreign row only
  // counts as a shared PC save if its filename says so.
  const readable = saves.filter((s) => isReadableSave(s, userId));

  // The panel keys its rows on the filename, so two accounts holding the same
  // PC filename have to collapse to one. Newest `clientModifiedAt` wins, same
  // rule as sync-check — a listing that disagreed with the sync verdict would
  // be worse than no listing at all.
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
      // Display name, not the user id: with PC saves shared across accounts a
      // row can belong to someone else, and the UI has to be able to say so.
      ownedBy: winner.user.displayName,
      // Present when the caller has their own copy of this filename that lost
      // the collision. Without it their own save has no reachable id at all.
      shadowedSaveId: shadowedOwn?.id ?? null,
      alsoHeldBy,
    }));
});
