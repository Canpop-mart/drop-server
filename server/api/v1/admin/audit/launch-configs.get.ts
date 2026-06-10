import aclManager from "~/server/internal/acls";
import { auditLaunchConfigs } from "~/server/internal/library/audit";

/**
 * On-demand launch-config + version integrity audit for the admin UI.
 *
 * `GET /api/v1/admin/audit/launch-configs` returns every issue found across
 * all GameVersions (orphaned versions, missing/invalid launch targets, missing
 * Windows launch) plus a summary. Report-only; the same logic backs the
 * `scan:launch-config-audit` task.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  return await auditLaunchConfigs();
});
