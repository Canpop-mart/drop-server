import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * POST /api/v1/client/saves/sync-check
 *
 * Pre-launch conflict detection. The client sends its local save state;
 * the server compares against cloud and returns one of three verdicts
 * per file: "download", "upload", or "conflict".
 *
 * Body: {
 *   gameId: string,
 *   localSaves: [{
 *     filename: string,
 *     saveType: string,        // "save" | "state" | "pc"
 *     dataHash: string,        // MD5 of local file
 *     clientModifiedAt: string  // ISO timestamp of local file mtime
 *   }]
 * }
 *
 * Response: {
 *   actions: [{
 *     filename: string,
 *     action: "download" | "upload" | "conflict" | "synced",
 *     cloudSave?: {             // present for download/conflict
 *       id: string,
 *       dataHash: string,
 *       size: number,
 *       clientModifiedAt: string,
 *       uploadedFrom: string,
 *       uploadedAt: string
 *     },
 *     localHash?: string        // echoed back for client convenience
 *   }],
 *   cloudOnly: [{               // saves on cloud but not in localSaves
 *     id: string,
 *     filename: string,
 *     saveType: string,
 *     dataHash: string,
 *     size: number,
 *     clientModifiedAt: string,
 *     uploadedFrom: string,
 *     uploadedAt: string
 *   }]
 * }
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readBody(h3);
  const { gameId, localSaves } = body;

  if (!gameId || !Array.isArray(localSaves)) {
    throw createError({
      statusCode: 400,
      statusMessage: "gameId and localSaves[] are required",
    });
  }

  // Fetch all cloud saves for this game+user (metadata only, no blob)
  const cloudSaves = await prisma.cloudSave.findMany({
    where: { gameId, userId },
    select: {
      id: true,
      filename: true,
      saveType: true,
      dataHash: true,
      size: true,
      uploadedFrom: true,
      clientModifiedAt: true,
      uploadedAt: true,
    },
  });

  const cloudByFilename = new Map(cloudSaves.map((s) => [s.filename, s]));
  const localFilenames = new Set(
    localSaves.map((s: { filename: string }) => s.filename),
  );

  const actions: Array<{
    filename: string;
    action: "download" | "upload" | "conflict" | "synced";
    cloudSave?: (typeof cloudSaves)[number];
    localHash?: string;
  }> = [];

  for (const local of localSaves) {
    const cloud = cloudByFilename.get(local.filename);

    if (!cloud) {
      // Local only — needs upload
      actions.push({
        filename: local.filename,
        action: "upload",
        localHash: local.dataHash,
      });
      continue;
    }

    if (cloud.dataHash === local.dataHash) {
      // Identical content — already synced
      actions.push({
        filename: local.filename,
        action: "synced",
        cloudSave: cloud,
        localHash: local.dataHash,
      });
      continue;
    }

    // Hashes differ — both sides have changes.
    // If cloud hash is empty (pre-migration save), treat as needing upload.
    if (!cloud.dataHash) {
      actions.push({
        filename: local.filename,
        action: "upload",
        cloudSave: cloud,
        localHash: local.dataHash,
      });
      continue;
    }

    // Both have data and hashes differ → CONFLICT.
    // The client is responsible for showing the conflict dialog.
    actions.push({
      filename: local.filename,
      action: "conflict",
      cloudSave: cloud,
      localHash: local.dataHash,
    });
  }

  // Cloud-only saves (not present locally) — client should download these
  const cloudOnly = cloudSaves.filter((s) => !localFilenames.has(s.filename));

  return { actions, cloudOnly };
});
