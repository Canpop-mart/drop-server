import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { startCheck } from "~/server/internal/library/revisions/publish";

/**
 * POST /api/v1/admin/game/[id]/versions/[versionId]/changes
 *
 * "Check for changes": starts a task that compares the version's folder as
 * it is now with its current revision (recording the revision's file hashes
 * first if it has none). Nothing is published and no file is changed.
 *
 * Returns { status: "checking" | "publishing", versionId, currentRevision,
 * taskId }. A check or publish already running for the version is returned
 * instead of starting another. When the check task finishes, GET this route
 * for the result.
 *
 * 400 with a reason for versions that can't be updated in place (depot,
 * multi-disc, archive, delta or under a delta, missing folder), 404 for an
 * unknown version.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");

  return await startCheck(gameId, versionId);
});
