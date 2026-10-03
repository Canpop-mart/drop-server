import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { startFingerprint } from "~/server/internal/library/revisions/publish";

/**
 * POST /api/v1/admin/game/[id]/versions/[versionId]/fingerprint
 *
 * "Record fingerprints": starts a task that records the file hashes of the
 * version's current revision (reading every file once), if it has none yet.
 * Press it before editing a version's folder so in-place updates can tell
 * which files players changed themselves.
 *
 * Returns { status: "ready" } when the fingerprints already exist, otherwise
 * { status: "fingerprinting" | "checking" | "publishing", taskId } for the
 * task doing it (a running check or publish records them too).
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

  return await startFingerprint(gameId, versionId);
});
