import { createHash } from "node:crypto";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  fetchUserQuota,
  quotaExceededMessage,
} from "~/server/internal/cloudsaves/quota";

/**
 * Upload a save file to cloud storage.
 * Body: { gameId, filename, saveType, data (base64), clientModifiedAt (ISO string),
 *         dataHash? (MD5 — computed server-side if omitted), uploadedFrom? (machine name) }
 *
 * Enforces the per-user cloud-save quota. The projected post-upload usage
 * (current usage minus the row being overwritten, if any, plus the new
 * payload) must fit within `User.cloudSaveQuotaBytes`. Returns HTTP 413 with
 * a human-readable message when exceeded — clients should surface this in
 * the sync UI rather than retrying.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

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

  // Per-user quota enforcement.
  // If a row already exists for this (gameId, userId, filename) — including
  // a tombstoned one we are about to revive via upsert — its current `size`
  // is part of `usedBytes` and will be replaced, so we subtract it from the
  // projection.
  const existing = await prisma.cloudSave.findUnique({
    where: { gameId_userId_filename: { gameId, userId, filename } },
    select: { size: true, deletedAt: true },
  });
  const { usedBytes, limitBytes } = await fetchUserQuota(userId);
  const existingSize =
    existing && existing.deletedAt === null ? existing.size : 0;
  const projected = usedBytes - existingSize + buffer.length;
  if (projected > limitBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: quotaExceededMessage(projected, limitBytes),
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
      // Resurrect tombstoned rows on re-upload (user moved a save back).
      deletedAt: null,
      deletedFrom: null,
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
