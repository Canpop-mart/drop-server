import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { getCheckResult } from "~/server/internal/library/revisions/publish";

/**
 * GET /api/v1/admin/game/[id]/versions/[versionId]/changes
 *
 * The result of the last finished "Check for changes" of this version since
 * the server started: { status: "ready", taskId, checkedAt, currentRevision,
 * unknownInCurrent, emulatorSetup, added[], changed[], removed[] (each
 * { path, size, emulatorSetup? }), totals }. 404 when there is none.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");

  const result = getCheckResult(gameId, versionId);
  if (!result)
    throw createError({
      statusCode: 404,
      statusMessage: "No finished check for this version. Check again.",
    });
  return result;
});
