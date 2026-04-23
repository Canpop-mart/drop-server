import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const BulkDownloadBody = type({
  // UUIDs; arktype's `uuid` narrowing rejects malformed strings upfront so we
  // don't run unvalidated input through a Prisma `in:` query.
  saveIds: "string.uuid[] >= 1",
}).configure(throwingArktype);

const MAX_SAVES_PER_REQUEST = 50;

/**
 * POST /api/v1/client/saves/bulk-download
 *
 * Download multiple save files in a single request.
 * Used during pre-launch sync to fetch all cloud saves that need downloading.
 *
 * Body: { saveIds: string[] }  // each must be a UUID
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
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readDropValidatedBody(h3, BulkDownloadBody);
  const { saveIds } = body;

  if (saveIds.length > MAX_SAVES_PER_REQUEST) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximum ${MAX_SAVES_PER_REQUEST} saves per bulk download`,
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
