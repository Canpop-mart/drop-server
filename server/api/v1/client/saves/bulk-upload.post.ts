import { createHash } from "node:crypto";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * POST /api/v1/client/saves/bulk-upload
 *
 * Upload multiple save files in a single request.
 * Used during post-exit sync to push all changed saves at once.
 *
 * Body: {
 *   gameId: string,
 *   uploadedFrom: string,   // machine hostname for conflict UI
 *   saves: [{
 *     filename: string,
 *     saveType: string,      // "save" | "state" | "pc"
 *     data: string,          // base64
 *     clientModifiedAt: string,  // ISO timestamp
 *     dataHash?: string      // MD5 — computed server-side if omitted
 *   }]
 * }
 *
 * Response: {
 *   results: [{
 *     filename: string,
 *     id: string,
 *     size: number,
 *     dataHash: string,
 *     uploadedAt: string
 *   }],
 *   errors: [{
 *     filename: string,
 *     error: string
 *   }]
 * }
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readBody(h3);
  const { gameId, uploadedFrom, saves } = body;

  if (!gameId || !Array.isArray(saves) || saves.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "gameId and saves[] are required",
    });
  }

  if (saves.length > 50) {
    throw createError({
      statusCode: 400,
      statusMessage: "Maximum 50 saves per bulk upload",
    });
  }

  const results: Array<{
    filename: string;
    id: string;
    size: number;
    dataHash: string;
    uploadedAt: Date;
  }> = [];

  const errors: Array<{ filename: string; error: string }> = [];

  for (const save of saves) {
    try {
      const { filename, saveType, data, clientModifiedAt, dataHash } = save;

      if (!filename || !saveType || !data) {
        errors.push({
          filename: filename || "(unknown)",
          error: "filename, saveType, and data are required",
        });
        continue;
      }

      if (saveType !== "save" && saveType !== "state" && saveType !== "pc") {
        errors.push({
          filename,
          error: "saveType must be 'save', 'state', or 'pc'",
        });
        continue;
      }

      const buffer = Buffer.from(data, "base64");

      if (buffer.length > 50 * 1024 * 1024) {
        errors.push({ filename, error: "File too large (max 50MB)" });
        continue;
      }

      const hash = dataHash || createHash("md5").update(buffer).digest("hex");

      const result = await prisma.cloudSave.upsert({
        where: {
          gameId_userId_filename: { gameId, userId, filename },
        },
        create: {
          gameId,
          userId,
          filename,
          saveType,
          size: buffer.length,
          data: buffer,
          dataHash: hash,
          uploadedFrom: uploadedFrom || "",
          clientModifiedAt: new Date(clientModifiedAt || Date.now()),
        },
        update: {
          data: buffer,
          size: buffer.length,
          saveType,
          dataHash: hash,
          uploadedFrom: uploadedFrom || "",
          clientModifiedAt: new Date(clientModifiedAt || Date.now()),
        },
      });

      results.push({
        filename: result.filename,
        id: result.id,
        size: result.size,
        dataHash: hash,
        uploadedAt: result.uploadedAt,
      });
    } catch (e) {
      errors.push({
        filename: save.filename || "(unknown)",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { results, errors };
});
