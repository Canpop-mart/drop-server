import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Delete a cloud save.
 * Body: { id }
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readBody(h3);
  const { id } = body;
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const result = await prisma.cloudSave.deleteMany({
    where: { id, userId },
  });

  if (result.count === 0) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  return { deleted: true };
});
