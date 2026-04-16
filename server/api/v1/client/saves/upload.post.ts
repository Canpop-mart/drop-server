import { createHash } from "node:crypto";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Upload a save file to cloud storage.
 * Body: { gameId, filename, saveType, data (base64), clientModifiedAt (ISO string),
 *         dataHash? (MD5 — computed server-side if omitted), uploadedFrom? (machine name) }
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readBody(h3);
  const {
    gameId,
    filename,
    saveType,
    data,
    clientModifiedAt,
    dataHash,
    uploadedFrom,
  } = body;

  if (!gameId || !filename || !saveType || !data) {
    throw createError({
      statusCode: 400,
      statusMessage: "gameId, filename, saveType, and data are required",
    });
  }

  if (saveType !== "save" && saveType !== "state" && saveType !== "pc") {
    throw createError({
      statusCode: 400,
      statusMessage: "saveType must be 'save', 'state', or 'pc'",
    });
  }

  const buffer = Buffer.from(data, "base64");

  if (buffer.length > 50 * 1024 * 1024) {
    throw createError({
      statusCode: 413,
      statusMessage: "Save file too large (max 50MB)",
    });
  }

  // Compute MD5 server-side if client didn't provide it
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

  return {
    id: result.id,
    filename: result.filename,
    size: result.size,
    dataHash: hash,
    uploadedAt: result.uploadedAt,
  };
});
