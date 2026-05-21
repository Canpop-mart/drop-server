import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import taskHandler from "~/server/internal/tasks";

/**
 * Signals a running task to cancel. The task's `run` must honour the
 * AbortSignal it receives via TaskRunContext for this to land — we
 * can't kill arbitrary async work. The receipt is written by the
 * normal end-of-task path with status="cancelled".
 *
 * Returns 404 if no running task with that id exists (already finished
 * or never started).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:cancel"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const taskId = requireRouterParam(h3, "id");
  const ok = taskHandler.cancel(taskId);
  if (!ok)
    throw createError({
      statusCode: 404,
      statusMessage: "No running task with that id",
    });
  return { cancelled: true };
});
