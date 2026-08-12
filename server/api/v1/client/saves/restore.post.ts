import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  fetchUserQuota,
  quotaExceededMessage,
} from "~/server/internal/cloudsaves/quota";
import {
  SAVE_WRITE_TRANSACTION_OPTIONS,
  snapshotSaveRevision,
} from "~/server/internal/cloudsaves/revisions";

const RestoreBody = type({
  revisionId: "string.uuid",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/saves/restore
 *
 * Put a previous version back as the live save. This is the recovery path
 * for the case the version history exists to cover: a sync overwrote a good
 * save with a bad one and the user needs the old bytes back.
 *
 * Body: { revisionId }
 *
 * The restore is itself reversible — the bytes being replaced are snapshotted
 * into a new revision first, in the same transaction, so a user who restores
 * the wrong version can walk back out of it.
 *
 * Ownership is checked through the parent save's `userId` (the same rule as
 * download.get.ts); a revision id belonging to someone else is a 404, not a
 * 403, so the endpoint doesn't confirm the id exists.
 *
 * Restoring revives a tombstoned save, matching upload's behaviour: asking
 * for an old version back is an unambiguous "I want this file".
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const { revisionId } = await readDropValidatedBody(h3, RestoreBody);

  // Metadata only for the ownership + quota checks — the blob is read inside
  // the transaction so we never hold a stale copy of it.
  const revision = await prisma.cloudSaveRevision.findUnique({
    where: { id: revisionId },
    select: {
      size: true,
      dataHash: true,
      save: {
        select: {
          id: true,
          gameId: true,
          userId: true,
          filename: true,
          size: true,
          dataHash: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!revision || revision.save.userId !== userId) {
    throw createError({ statusCode: 404, statusMessage: "Revision not found" });
  }

  const save = revision.save;

  if (save.dataHash && save.dataHash === revision.dataHash) {
    // Already the live bytes. Report it rather than churning a duplicate
    // revision through the history for a no-op.
    return {
      restored: false,
      alreadyCurrent: true,
      id: save.id,
      filename: save.filename,
      size: save.size,
      dataHash: save.dataHash,
    };
  }

  // Quota: an older version can be larger than the one it replaces. Same
  // projection as upload — subtract the bytes we're displacing, but only if
  // the row is active, since tombstoned rows aren't in `usedBytes`.
  const { usedBytes, limitBytes } = await fetchUserQuota(userId);
  const displacedSize = save.deletedAt === null ? save.size : 0;
  const projected = usedBytes - displacedSize + revision.size;
  if (projected > limitBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: quotaExceededMessage(projected, limitBytes),
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the GC task could have pruned this
    // revision between the checks above and here.
    const source = await tx.cloudSaveRevision.findUnique({
      where: { id: revisionId },
      select: {
        saveType: true,
        size: true,
        data: true,
        dataHash: true,
        uploadedFrom: true,
        clientModifiedAt: true,
      },
    });
    if (!source) {
      throw createError({
        statusCode: 404,
        statusMessage: "Revision not found",
      });
    }

    // Make the restore undoable before we overwrite anything.
    await snapshotSaveRevision(
      tx,
      { gameId: save.gameId, userId, filename: save.filename },
      source.dataHash,
    );

    // updateMany + rowcount per the repo's `drop/no-prisma-delete` rule.
    const updated = await tx.cloudSave.updateMany({
      where: { id: save.id, userId },
      data: {
        data: source.data,
        size: source.size,
        saveType: source.saveType,
        dataHash: source.dataHash,
        // Keep the provenance of the bytes themselves. sync-check compares
        // hashes rather than mtimes, so putting the original timestamps back
        // restores the row faithfully without confusing conflict detection.
        uploadedFrom: source.uploadedFrom,
        clientModifiedAt: source.clientModifiedAt,
        deletedAt: null,
        deletedFrom: null,
      },
    });
    if (updated.count === 0) {
      throw createError({ statusCode: 404, statusMessage: "Save not found" });
    }

    return source;
  }, SAVE_WRITE_TRANSACTION_OPTIONS);

  return {
    restored: true,
    id: save.id,
    filename: save.filename,
    saveType: result.saveType,
    size: result.size,
    dataHash: result.dataHash,
    clientModifiedAt: result.clientModifiedAt,
    uploadedFrom: result.uploadedFrom,
  };
});
