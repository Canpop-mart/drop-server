import { createHash } from "node:crypto";
import { type } from "arktype";
import sanitizeFilename from "sanitize-filename";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

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
          clientModifiedAt: clientModifiedAtSafe,
        },
        update: {
          data: buffer,
          size: buffer.length,
          saveType,
          dataHash: hash,
          uploadedFrom: uploadedFrom || "",
          clientModifiedAt: clientModifiedAtSafe,
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
