import aclManager from "~/server/internal/acls";
import { auditLibrary } from "~/server/internal/library/audit";

/**
 * On-demand library integrity audit for the admin UI.
 *
 * `GET /api/v1/admin/audit/library` returns every issue found across the
 * library — orphaned/unreadable versions, missing/invalid launch targets,
 * versions with no Windows launch, and orphaned folders on disk — plus a
 * summary. Report-only; the same logic backs the scan:library-integrity task.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  return await auditLibrary();
});
