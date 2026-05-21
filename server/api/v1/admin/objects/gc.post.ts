import aclManager from "~/server/internal/acls";
import taskHandler from "~/server/internal/tasks";

/**
 * POST /api/v1/admin/objects/gc
 *
 * Manually trigger a `cleanup:objects` run. Goes through the same
 * `runTaskGroupByName` path the regular admin task button uses, so
 * dedup / single-flight / receipt / live progress all work
 * identically. Returns the new task id so the UI can subscribe.
 *
 * Gated by `task:start` rather than `maintenance:read` because this
 * is starting work, not reading state.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:start"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = await taskHandler.runTaskGroupByName("cleanup:objects");
  if (!id)
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to start cleanup:objects task",
    });
  return { taskId: id };
});
