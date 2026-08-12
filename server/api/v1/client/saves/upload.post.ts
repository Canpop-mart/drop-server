import { createHash } from "node:crypto";
import sanitizeFilename from "sanitize-filename";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  fetchUserQuota,
  quotaExceededMessage,
} from "~/server/internal/cloudsaves/quota";
import {
  SAVE_WRITE_TRANSACTION_OPTIONS,
  snapshotSaveRevision,
} from "~/server/internal/cloudsaves/revisions";

const MAX_SAVE_BYTES = 50 * 1024 * 1024; // 50MiB — matches bulk-upload
const MAX_FILENAME_LEN = 255;
const MAX_UPLOADED_FROM_LEN = 128;

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
 *
 * Validation here mirrors `bulk-upload.post.ts` (size cap, filename sanitise,
 * timestamp sanity bounds, dataHash length) so a single-file upload can never
 * land a row that a bulk upload would have rejected — they share the same
 * downstream storage and quota accounting.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readBody(h3);
  const {
    gameId,
    filename: rawFilename,
    saveType,
    data,
    clientModifiedAt,
    dataHash,
    uploadedFrom,
  } = body;

  if (!gameId || !rawFilename || !saveType || !data) {
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

  // Defense-in-depth: filenames are opaque DB keys (never used as filesystem
  // paths) but sanitise anyway so a future code path can't be tricked into
  // path traversal. sanitize-filename strips separators + control chars and
  // truncates dangerous prefixes; we then cap the length to keep it within
  // the column constraint and DB index limits.
  const filename = sanitizeFilename(String(rawFilename)).slice(
    0,
    MAX_FILENAME_LEN,
  );
  if (!filename) {
    throw createError({
      statusCode: 400,
      statusMessage: "Filename reduced to empty after sanitization",
    });
  }

  if (typeof data !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "data must be a base64 string",
    });
  }

  const buffer = Buffer.from(data, "base64");

  // Reject empties: a base64 string that decodes to zero bytes is almost
  // always a client bug (read of a partially-written save) and creates a
  // useless row that still pays the quota tax of the metadata.
  if (buffer.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Decoded save is empty",
    });
  }

  if (buffer.length > MAX_SAVE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Save file too large (max ${MAX_SAVE_BYTES / (1024 * 1024)}MB)`,
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

  // Parse client-supplied timestamp with sanity bounds (mirrors bulk-upload):
  // reject futures > 5min of clock skew and anything older than year 2000,
  // both of which would corrupt the conflict-detection mtime comparison.
  const parsedClientModified = clientModifiedAt
    ? new Date(clientModifiedAt)
    : null;
  const now = Date.now();
  const maxAllowed = now + 5 * 60 * 1000;
  const minAllowed = new Date("2000-01-01T00:00:00Z").getTime();
  const clientModifiedAtSafe =
    !parsedClientModified ||
    isNaN(parsedClientModified.getTime()) ||
    parsedClientModified.getTime() > maxAllowed ||
    parsedClientModified.getTime() < minAllowed
      ? new Date(now)
      : parsedClientModified;

  // Compute MD5 server-side if client didn't provide it. If client did,
  // sanity-check the length so a garbage value can't be persisted (an MD5
  // hex digest is always 32 chars).
  let hash: string;
  if (typeof dataHash === "string" && dataHash.length > 0) {
    if (dataHash.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(dataHash)) {
      throw createError({
        statusCode: 400,
        statusMessage: "dataHash must be a 32-character hex MD5",
      });
    }
    hash = dataHash.toLowerCase();
  } else {
    hash = createHash("md5").update(buffer).digest("hex");
  }

  const uploadedFromSafe =
    typeof uploadedFrom === "string"
      ? uploadedFrom.slice(0, MAX_UPLOADED_FROM_LEN)
      : "";

  // Copy the bytes we're about to overwrite into history first, in the same
  // transaction as the upsert (mirrors bulk-upload). A crash between the two
  // would otherwise lose both the old version and the new one.
  const result = await prisma.$transaction(async (tx) => {
    await snapshotSaveRevision(tx, { gameId, userId, filename }, hash);

    return await tx.cloudSave.upsert({
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
        uploadedFrom: uploadedFromSafe,
        clientModifiedAt: clientModifiedAtSafe,
      },
      update: {
        data: buffer,
        size: buffer.length,
        saveType,
        dataHash: hash,
        uploadedFrom: uploadedFromSafe,
        clientModifiedAt: clientModifiedAtSafe,
        // Resurrect tombstoned rows on re-upload (user moved a save back).
        deletedAt: null,
        deletedFrom: null,
      },
    });
  }, SAVE_WRITE_TRANSACTION_OPTIONS);

  return {
    id: result.id,
    filename: result.filename,
    size: result.size,
    dataHash: hash,
    uploadedAt: result.uploadedAt,
  };
});
