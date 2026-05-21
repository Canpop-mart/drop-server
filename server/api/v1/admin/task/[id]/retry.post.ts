import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import taskHandler from "~/server/internal/tasks";
import type { TaskGroup } from "~/server/internal/tasks/group";

/**
 * Re-runs a failed / cancelled / orphaned task. Only works for tasks
 * built from the registry — ad-hoc tasks (game imports etc.) carry
 * closures (e.g. captured user-uploaded metadata) that can't be
 * reconstructed from the receipt. For those, the admin re-runs the
 * original action from the UI that created them.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:retry"]);
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

  const retryArgs = receipt.retryArgs as
    | {
        taskGroup: TaskGroup;
        kind: "registered" | "ad-hoc";
      }
    | null;

  if (!retryArgs || retryArgs.kind !== "registered") {
    throw createError({
      statusCode: 400,
      statusMessage:
        "This task type cannot be retried automatically — re-run the original action.",
    });
  }

  // Use the registry path so the schedule, lifecycle hooks, and acls
  // come from the same source of truth as the original run.
  const newId = await taskHandler.runTaskGroupByName(retryArgs.taskGroup);
  if (!newId)
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to enqueue retry",
    });
  return { id: newId };
});
