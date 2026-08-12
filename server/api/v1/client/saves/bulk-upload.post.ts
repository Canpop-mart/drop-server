import { createHash } from "node:crypto";
import { type } from "arktype";
import sanitizeFilename from "sanitize-filename";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
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

const MAX_SAVES_PER_REQUEST = 50;
const MAX_SAVE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_UPLOADED_FROM_LEN = 128;
const MAX_FILENAME_LEN = 255;

// Note: unlike bulk-download (which takes saveIds), bulk-upload accepts a list
// of save BODIES. We arktype-validate the structure upfront so we never run
// the loop on malformed input; per-save content checks (size, base64 decode)
// still happen inline because those errors should become per-save `errors[]`
// entries rather than a whole-batch 400.
const BulkUploadBody = type({
  gameId: "string.uuid",
  "uploadedFrom?": `string <= ${MAX_UPLOADED_FROM_LEN}`,
  saves: type({
    filename: `0 < string <= ${MAX_FILENAME_LEN}`,
    saveType: "'save' | 'state' | 'pc'",
    data: "string", // base64-encoded; size validated after decode
    clientModifiedAt: "string",
    "dataHash?": "string",
  })
    .array()
    .moreThanLength(0)
    .atMostLength(MAX_SAVES_PER_REQUEST),
}).configure(throwingArktype);

/**
 * POST /api/v1/client/saves/bulk-upload
 *
 * Upload multiple save files in a single request.
 * Used during post-exit sync to push all changed saves at once.
 *
 * Quota handling: partial-acceptance.
 *   - Pre-decode every save and compute its replacement bytes.
 *   - Walk saves in order, accepting each that still fits within the user's
 *     remaining quota; ones that don't fit produce a per-file error entry
 *     with `quota_exceeded` and are skipped. This way a single huge file
 *     doesn't black-hole a batch of small ones.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readDropValidatedBody(h3, BulkUploadBody);
  const { gameId, uploadedFrom, saves } = body;

  // Verify the game exists and the user has playtime against it (or at least
  // that the game is a real game, not an arbitrary UUID). The FK on cloudSave
  // would catch this too, but we want a clean 404 instead of a DB error.
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  const results: Array<{
    filename: string;
    id: string;
    size: number;
    dataHash: string;
    uploadedAt: Date;
  }> = [];

  const errors: Array<{ filename: string; error: string }> = [];

  // Quota: snapshot current usage + limit once, then accept saves one by one
  // until the running total would exceed the limit. We refetch sizes of any
  // saves being overwritten so we don't double-count their existing bytes
  // against the quota.
  const { usedBytes, limitBytes } = await fetchUserQuota(userId);
  let runningBytes = usedBytes;

  // Bulk-fetch any pre-existing rows for these filenames so we can subtract
  // their current `size` when computing the projection. Tombstoned rows are
  // included — we'll be reviving them, so their stored bytes belong to the
  // user regardless of the `deletedAt` flag.
  const incomingFilenames = saves.map((s) => sanitizeFilename(s.filename));
  const existing = await prisma.cloudSave.findMany({
    where: {
      gameId,
      userId,
      filename: { in: incomingFilenames },
    },
    select: { filename: true, size: true, deletedAt: true },
  });
  const existingByFilename = new Map(
    existing
      // Only subtract sizes of active rows: tombstoned rows are
      // excluded from `usedBytes` so their size isn't in the snapshot.
      .filter((e) => e.deletedAt === null)
      .map((e) => [e.filename, e.size]),
  );

  for (const save of saves) {
    try {
      const { saveType, data, clientModifiedAt, dataHash } = save;

      // Defense-in-depth: even though the filename is stored as an opaque DB
      // key (never used as a filesystem path), pass it through sanitize-filename
      // to strip path separators and control characters — if any downstream
      // code ever decides to use it as a filename, it won't be a traversal vector.
      const filename = sanitizeFilename(save.filename);
      if (!filename) {
        errors.push({
          filename: save.filename,
          error: "Filename reduced to empty after sanitization",
        });
        continue;
      }

      const buffer = Buffer.from(data, "base64");

      if (buffer.length === 0) {
        errors.push({ filename, error: "Decoded save is empty" });
        continue;
      }

      if (buffer.length > MAX_SAVE_BYTES) {
        errors.push({
          filename,
          error: `File too large (max ${MAX_SAVE_BYTES / (1024 * 1024)}MB)`,
        });
        continue;
      }

      // Quota check before we touch the DB. `existingSize` is the bytes the
      // current row contributes to `runningBytes`; we subtract it because
      // the row will be replaced, not added on top.
      const existingSize = existingByFilename.get(filename) ?? 0;
      const projected = runningBytes - existingSize + buffer.length;
      if (projected > limitBytes) {
        errors.push({
          filename,
          error: quotaExceededMessage(projected, limitBytes),
        });
        continue;
      }

      // A client-supplied dataHash must be a valid MD5 hex (matches the single
      // upload endpoint); otherwise compute it from the decoded bytes.
      if (dataHash !== undefined && !/^[0-9a-fA-F]{32}$/.test(dataHash)) {
        errors.push({
          filename,
          error: "Invalid dataHash (expected a 32-character MD5 hex string)",
        });
        continue;
      }
      const hash = dataHash || createHash("md5").update(buffer).digest("hex");

      // Parse client-supplied timestamp with sanity bounds. Reject future
      // timestamps (> 5min clock skew tolerance) and reset-to-now anything
      // older than year 2000. Invalid/missing falls back to server's now.
      const parsedClientModified = new Date(clientModifiedAt);
      const now = Date.now();
      const maxAllowed = now + 5 * 60 * 1000;
      const minAllowed = new Date("2000-01-01T00:00:00Z").getTime();
      const clientModifiedAtSafe =
        isNaN(parsedClientModified.getTime()) ||
        parsedClientModified.getTime() > maxAllowed ||
        parsedClientModified.getTime() < minAllowed
          ? new Date(now)
          : parsedClientModified;

      // Preserve the bytes we're about to destroy, in the same transaction
      // as the upsert. Split commits would leave a crash window where the
      // old version is gone and the new one never landed.
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
            uploadedFrom: uploadedFrom || "",
            clientModifiedAt: clientModifiedAtSafe,
          },
          update: {
            data: buffer,
            size: buffer.length,
            saveType,
            dataHash: hash,
            uploadedFrom: uploadedFrom || "",
            clientModifiedAt: clientModifiedAtSafe,
            // Resurrect tombstoned rows on re-upload.
            deletedAt: null,
            deletedFrom: null,
          },
        });
      }, SAVE_WRITE_TRANSACTION_OPTIONS);

      // Update the running tally only after a successful upsert so a thrown
      // exception doesn't lock subsequent saves out of an artificial limit.
      runningBytes = projected;
      // Future iterations on the same filename (unlikely but possible in a
      // single batch) should now treat the post-upsert size as the baseline.
      existingByFilename.set(filename, buffer.length);

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
