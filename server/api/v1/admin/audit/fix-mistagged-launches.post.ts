import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { auditLibrary } from "~/server/internal/library/audit";

/**
 * POST /api/v1/admin/audit/fix-mistagged-launches
 *
 * Corrects Windows binaries that are tagged as Linux launches. These run today
 * via Proton's NeedsCompat fallback, but the platform tag is wrong. For each
 * affected version:
 *  - if the version already has a Windows launch, the Linux .exe launch is a
 *    duplicate and is removed;
 *  - otherwise the Linux launch is re-tagged to Windows.
 *
 * Re-detects at call time via the audit, so it only touches launches that are
 * still mistagged.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, [
    "game:version:update",
    "game:version:delete",
  ]);
  if (!allowed) throw createError({ statusCode: 403 });

  const audit = await auditLibrary();
  const mistagged = audit.issues.filter(
    (i) => i.type === "mistagged_linux_launch" && i.launchId && i.versionId,
  );
  if (mistagged.length === 0) return { retagged: 0, deleted: 0 };

  // A version already having a Windows launch means the Linux .exe entry is
  // redundant; otherwise re-tagging it is what gives the version a Windows
  // launch. Compute this from the current DB before mutating anything.
  const versionIds = [...new Set(mistagged.map((i) => i.versionId as string))];
  const launches = await prisma.launchConfiguration.findMany({
    where: { versionId: { in: versionIds } },
    select: { versionId: true, platform: true },
  });
  const hasWindows = new Set(
    launches.filter((l) => l.platform === "Windows").map((l) => l.versionId),
  );

  const toDelete: string[] = [];
  const toRetag: string[] = [];
  for (const m of mistagged) {
    if (hasWindows.has(m.versionId as string))
      toDelete.push(m.launchId as string);
    else toRetag.push(m.launchId as string);
  }

  let deleted = 0;
  let retagged = 0;
  if (toDelete.length > 0) {
    const r = await prisma.launchConfiguration.deleteMany({
      where: { launchId: { in: toDelete } },
    });
    deleted = r.count;
  }
  if (toRetag.length > 0) {
    const r = await prisma.launchConfiguration.updateMany({
      where: { launchId: { in: toRetag } },
      data: { platform: "Windows" },
    });
    retagged = r.count;
  }

  return { retagged, deleted };
});
