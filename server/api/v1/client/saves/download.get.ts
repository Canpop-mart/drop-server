import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Download a cloud save's data.
 * Query: ?id=xxx (cloud save ID)
 * Returns the raw binary data as base64.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getQuery(h3).id as string;
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const save = await prisma.cloudSave.findUnique({
    where: { id },
    select: { userId: true, data: true, filename: true, saveType: true },
  });

  if (!save || save.userId !== userId) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  return {
    filename: save.filename,
    saveType: save.saveType,
    data: Buffer.from(save.data).toString("base64"),
  };
});
