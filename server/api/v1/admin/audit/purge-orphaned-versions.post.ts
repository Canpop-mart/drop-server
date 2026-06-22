import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { auditLibrary } from "~/server/internal/library/audit";

/**
 * POST /api/v1/admin/audit/purge-orphaned-versions
 *
 * Re-runs the library audit and deletes every GameVersion flagged as
 * orphaned (a DB row whose folder is gone on disk). Detection happens at call
 * time, not from a stale report, so a version whose folder has reappeared is
 * never deleted. Removes the database rows only; nothing on disk is touched.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const audit = await auditLibrary();
  const orphanIds = audit.issues
    .filter((i) => i.type === "orphaned_version" && i.versionId)
    .map((i) => i.versionId as string);

  if (orphanIds.length === 0) return { deleted: 0 };

  const { count } = await prisma.gameVersion.deleteMany({
    where: { versionId: { in: orphanIds } },
  });
  return { deleted: count };
});
