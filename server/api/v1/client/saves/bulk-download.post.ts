import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * POST /api/v1/client/saves/bulk-download
 *
 * Download multiple save files in a single request.
 * Used during pre-launch sync to fetch all cloud saves that need downloading.
 *
 * Body: { saveIds: string[] }
 *
 * Response: {
 *   saves: [{
 *     id: string,
 *     filename: string,
 *     saveType: string,
 *     dataHash: string,
 *     data: string  // base64
 *   }]
 * }
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readBody(h3);
  const { saveIds } = body;

  if (!Array.isArray(saveIds) || saveIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "saveIds[] is required and must be non-empty",
    });
  }

  if (saveIds.length > 50) {
    throw createError({
      statusCode: 400,
      statusMessage: "Maximum 50 saves per bulk download",
    });
  }

  const saves = await prisma.cloudSave.findMany({
    where: {
      id: { in: saveIds },
      userId, // enforce ownership
    },
    select: {
      id: true,
      filename: true,
      saveType: true,
      dataHash: true,
      data: true,
    },
  });

  return {
    saves: saves.map((s) => ({
      id: s.id,
      filename: s.filename,
      saveType: s.saveType,
      dataHash: s.dataHash,
      data: Buffer.from(s.data).toString("base64"),
    })),
  };
});
