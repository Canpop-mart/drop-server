import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Delete a cloud save.
 * Body: { id }
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

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
