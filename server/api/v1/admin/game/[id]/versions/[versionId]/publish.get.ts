import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { getPublishOutcome } from "~/server/internal/library/revisions/publish";

/**
 * GET /api/v1/admin/game/[id]/versions/[versionId]/publish
 *
 * The outcome of the last finished publish of this version since the server
 * started: { taskId, finishedAt, fromRevision, revision, published, totals },
 * where totals are what actually changed from fromRevision (after emulator
 * setup). 404 when there is none.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");

  const outcome = getPublishOutcome(gameId, versionId);
  if (!outcome)
    throw createError({
      statusCode: 404,
      statusMessage: "No finished publish for this version.",
    });
  return outcome;
});
