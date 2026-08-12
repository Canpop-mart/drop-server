import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { isReadableSave } from "~/server/internal/cloudsaves/scope";

/**
 * GET /api/v1/client/saves/revisions?id=xxx (cloud save ID)
 *
 * List the previous versions kept for one save, newest first. Metadata only —
 * blobs come back through restore, not here, so a listing stays cheap.
 *
 * Always the CALLER'S OWN history, never another account's. `id` names a save
 * the caller can read, which for a shared PC save may be a row belonging to
 * somebody else — the read endpoints hand out the winner of a filename
 * collision. Resolving that to `(gameId, userId, filename)` is what makes the
 * version history reachable for the account whose row lost; keyed on the row
 * id alone, a shadowed owner got a 404 for their own bytes and the
 * point-in-time restore behind them was unreachable.
 *
 * Tombstoned parents are still listable: a user who deleted a save and wants
 * an older version back is exactly the person this endpoint is for, and the
 * bytes are theirs until the 30-day GC takes them.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const id = getQuery(h3).id as string;
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const named = await prisma.cloudSave.findUnique({
    where: { id },
    select: { gameId: true, userId: true, saveType: true, filename: true },
  });
  if (!named || !isReadableSave(named, userId)) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  const save = await prisma.cloudSave.findUnique({
    where: {
      gameId_userId_filename: {
        gameId: named.gameId,
        userId,
        filename: named.filename,
      },
    },
    select: {
      id: true,
      filename: true,
      dataHash: true,
      size: true,
      uploadedFrom: true,
      clientModifiedAt: true,
      deletedAt: true,
    },
  });

  if (!save) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  const revisions = await prisma.cloudSaveRevision.findMany({
    where: { saveId: save.id },
    select: {
      id: true,
      saveType: true,
      size: true,
      dataHash: true,
      uploadedFrom: true,
      clientModifiedAt: true,
      supersededAt: true,
    },
    // No take limit. The write path already caps this at MAX_SAVE_REVISIONS,
    // and if a race left a fourth row behind, hiding a recoverable version
    // from the person trying to recover is the wrong side to err on.
    orderBy: [{ supersededAt: "desc" }, { id: "desc" }],
  });

  return {
    // Echo the live version so a client can render "current" alongside the
    // history without a second call. `id` is the caller's own row, which is
    // not necessarily the id they asked with.
    current: {
      id: save.id,
      filename: save.filename,
      size: save.size,
      dataHash: save.dataHash,
      uploadedFrom: save.uploadedFrom,
      clientModifiedAt: save.clientModifiedAt,
      deletedAt: save.deletedAt,
    },
    revisions,
  };
});
