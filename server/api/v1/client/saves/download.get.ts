import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { isReadableSave } from "~/server/internal/cloudsaves/scope";

/**
 * Download a cloud save's data.
 * Query: ?id=xxx (cloud save ID)
 * Returns the raw binary data as base64.
 *
 * Readable if the row is yours, or if it is a PC save belonging to any
 * account on this server — see `internal/cloudsaves/scope.ts`.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const id = getQuery(h3).id as string;
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const save = await prisma.cloudSave.findUnique({
    where: { id },
    select: {
      userId: true,
      data: true,
      filename: true,
      saveType: true,
      deletedAt: true,
    },
  });

  // Tombstoned rows are invisible to downloads — a stale client holding an
  // ID from before the delete should get a 404, not the deleted bytes.
  if (!save || !isReadableSave(save, userId) || save.deletedAt !== null) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  return {
    filename: save.filename,
    saveType: save.saveType,
    data: Buffer.from(save.data).toString("base64"),
  };
});
