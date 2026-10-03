import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { startPublish } from "~/server/internal/library/revisions/publish";

/**
 * POST /api/v1/admin/game/[id]/versions/[versionId]/publish
 *
 * "Publish update": starts a task that runs the import pipeline's file
 * phases on the version's edited folder, then stores the result under the
 * same versionId as the next revision and clears the stale caches. Returns
 * { status: "publishing", versionId, currentRevision, taskId } (the running
 * task if a publish of this version is already in progress). If no file
 * differs from the current revision the task ends without publishing. When
 * the task finishes, GET this route for the outcome.
 *
 * 400 with a reason for versions that can't be updated in place, 404 for an
 * unknown version.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");

  return await startPublish(gameId, versionId);
});
