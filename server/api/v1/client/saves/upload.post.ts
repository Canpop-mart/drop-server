import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Upload a save file to cloud storage.
 * Body: { gameId, filename, saveType, data (base64), clientModifiedAt (ISO string) }
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
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

  // Decode base64 data
  const buffer = Buffer.from(data, "base64");

  // Max 50MB per save file
  if (buffer.length > 50 * 1024 * 1024) {
    throw createError({
      statusCode: 413,
      statusMessage: "Save file too large (max 50MB)",
    });
  }

  const result = await prisma.cloudSave.upsert({
    where: {
      gameId_userId_filename: {
        gameId,
        userId: user.id,
        filename,
      },
    },
    create: {
      gameId,
      userId: user.id,
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
