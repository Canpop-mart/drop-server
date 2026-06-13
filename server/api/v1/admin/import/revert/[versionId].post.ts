import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import libraryManager from "~/server/internal/library";

/**
 * POST /api/v1/admin/import/revert/[versionId]
 *
 * Reverts a previously-imported version: deletes the GameVersion row
 * (which cascades the ImportReceipt) so the version becomes available
 * to re-import.
 *
 * Idempotent-ish: a second call 404s because the version is gone.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const versionId = requireRouterParam(h3, "versionId");

  const result = await libraryManager.revertImportedVersion(versionId);

  return {
    reverted: true,
    gameId: result.gameId,
  };
});
