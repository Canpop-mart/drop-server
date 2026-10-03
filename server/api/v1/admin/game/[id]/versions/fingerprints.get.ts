import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import { listFingerprints } from "~/server/internal/library/revisions/publish";

/**
 * GET /api/v1/admin/game/[id]/versions/fingerprints
 *
 * Which versions of the game have fingerprints (file hashes) for their
 * current revision: { [versionId]: { revision, unknown } }, where `unknown`
 * counts files whose original hash could not be established. Versions
 * missing from the map have none.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  return await listFingerprints(gameId);
});
