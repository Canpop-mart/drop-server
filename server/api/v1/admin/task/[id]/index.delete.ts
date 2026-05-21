import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Permanently removes a finished TaskReceipt row. Refuses to delete
 * receipts that are still in-flight (status="in_progress") — use the
 * cancel endpoint for those.
 *
 * Does NOT delete the legacy Task row; that table is being phased out
 * and we don't want delete races during the transition.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const taskId = requireRouterParam(h3, "id");
  const receipt = await prisma.taskReceipt.findUnique({
    where: { id: taskId },
  });
  if (!receipt)
    throw createError({
      statusCode: 404,
      statusMessage: "No receipt with that id",
    });
  if (receipt.status === "in_progress") {
    throw createError({
      statusCode: 409,
      statusMessage: "Task is still running — cancel it first",
    });
  }

  // eslint-disable-next-line drop/no-prisma-delete
  await prisma.taskReceipt.delete({ where: { id: taskId } });
  return { deleted: true };
});
