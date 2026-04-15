import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Download a cloud save's data.
 * Query: ?id=xxx (cloud save ID)
 * Returns the raw binary data as base64.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const id = getQuery(h3).id as string;
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const save = await prisma.cloudSave.findUnique({
    where: { id },
    select: { userId: true, data: true, filename: true, saveType: true },
  });

  if (!save || save.userId !== user.id) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  return {
    filename: save.filename,
    saveType: save.saveType,
    data: Buffer.from(save.data).toString("base64"),
  };
});
