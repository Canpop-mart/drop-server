import aclManager from "~/server/internal/acls";
import objectHandler from "~/server/internal/objects";
import prisma from "~/server/internal/db/database";
import {
  OBJECT_REFERENCE_COLUMNS,
  findUnregisteredObjectColumns,
} from "~/server/internal/objects/objectRefs";

/**
 * GET /api/v1/admin/objects
 *
 * Stats payload for the admin object browser. Returns:
 *   - count / totalSize / top — backend statAll() result
 *   - registry — reference columns currently tracked by the GC
 *   - drift — *ObjectId columns on Prisma models that aren't
 *     registered (would be deleted as orphans if GC ran today)
 *   - lastGc — most recent cleanup:objects TaskReceipt summary so
 *     the operator can see when GC last ran without flipping tabs
 *
 * Scoped to `maintenance:read` (same ACL the GC task uses).
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const stats = await objectHandler.statAll(20);
  const drift = findUnregisteredObjectColumns();

  const lastGc = await prisma.taskReceipt.findFirst({
    where: { taskGroup: "cleanup:objects" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      progress: true,
      error: true,
    },
  });

  return {
    count: stats.count,
    totalSize: stats.totalSize,
    top: stats.top.map((o) => ({
      id: o.id,
      size: o.size,
      mtime: o.mtime.toISOString(),
    })),
    registry: OBJECT_REFERENCE_COLUMNS,
    drift,
    lastGc,
  };
});
