import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Upload a save file to cloud storage.
 * Body: { gameId, filename, saveType, data (base64), clientModifiedAt (ISO string) }
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readBody(h3);
  const { gameId, filename, saveType, data, clientModifiedAt } = body;

  if (!gameId || !filename || !saveType || !data) {
    throw createError({
      statusCode: 400,
      statusMessage: "gameId, filename, saveType, and data are required",
    });
  }

  if (saveType !== "save" && saveType !== "state") {
    throw createError({
      statusCode: 400,
      statusMessage: "saveType must be 'save' or 'state'",
    });
  }

  const buffer = Buffer.from(data, "base64");

  if (buffer.length > 50 * 1024 * 1024) {
    throw createError({
      statusCode: 413,
      statusMessage: "Save file too large (max 50MB)",
    });
  }

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
      clientModifiedAt: new Date(clientModifiedAt || Date.now()),
    },
    update: {
      data: buffer,
      size: buffer.length,
      saveType,
      clientModifiedAt: new Date(clientModifiedAt || Date.now()),
    },
  });

  return {
    id: result.id,
    filename: result.filename,
    size: result.size,
    uploadedAt: result.uploadedAt,
  };
});
