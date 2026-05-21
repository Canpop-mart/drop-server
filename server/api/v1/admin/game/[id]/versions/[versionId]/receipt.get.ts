import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * GET /api/v1/admin/game/[id]/versions/[versionId]/receipt
 *
 * Returns the structured ImportReceipt for a version, or `null` when the
 * version predates the receipt feature / was created without one. The
 * admin version detail page renders this so operators can see phase
 * timings, file/chunk counts, the DLL-swap outcome and any warnings.
 *
 * `totalSizeBytes` is serialised as a string because it's a Prisma
 * BigInt and JSON has no native bigint.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const versionId = requireRouterParam(h3, "versionId");

  const receipt = await prisma.importReceipt.findUnique({
    where: { gameVersionId: versionId },
  });

  if (!receipt) return { receipt: null };

  return {
    receipt: {
      id: receipt.id,
      gameVersionId: receipt.gameVersionId,
      createdAt: receipt.createdAt,
      phaseTimings: receipt.phaseTimingsJson,
      fileCount: receipt.fileCount,
      totalSizeBytes: receipt.totalSizeBytes.toString(),
      chunkCount: receipt.chunkCount,
      dllSwapApplied: receipt.dllSwapApplied,
      dllSwapName: receipt.dllSwapName,
      warnings: receipt.warnings,
    },
  };
});
