import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
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
 *   }],
 *   tombstones: [{              // saves the user deleted from another device
 *     filename: string,         // client deletes its local copy of this file
 *     deletedAt: string,        // ISO timestamp of the soft-delete
 *     deletedFrom: string       // device that initiated the delete
 *   }]
 * }
 *
 * Tombstones are saves the user actively deleted (soft-deleted server-side
 * via `delete.post.ts`) from a different device. The client should remove
 * its local copy after backing it up — this is the cross-device mirror of
 * the delete operation.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readBody(h3);
  const { gameId, localSaves } = body;

  if (!gameId || !Array.isArray(localSaves)) {
    throw createError({
      statusCode: 400,
      statusMessage: "gameId and localSaves[] are required",
    });
  }

  // Fetch all cloud saves for this game+user (metadata only, no blob),
  // including tombstoned ones — we split them client-side. We need
  // `deletedAt`/`deletedFrom` for the tombstone array.
  const allCloudSaves = await prisma.cloudSave.findMany({
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
      deletedAt: true,
      deletedFrom: true,
    },
  });

  // Active rows feed the normal conflict-detection path; tombstoned rows
  // feed the `tombstones` array and are otherwise invisible to the client.
  const cloudSaves = allCloudSaves
    .filter((s) => s.deletedAt === null)
    // strip the tombstone fields from the public response shape; clients
    // don't need them on active rows and it keeps the JSON small.
    .map(({ deletedAt: _da, deletedFrom: _df, ...rest }) => rest);

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
      // Local only — needs upload. Note: if there's a tombstone for this
      // filename we DON'T silently re-upload; that's the whole point of the
      // tombstone flow. The client receives both the "upload" action AND
      // the matching tombstone entry; its sync code prefers the tombstone
      // (i.e. delete locally) when both are present.
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

  // Cloud-only saves (not present locally) — client should download these.
  const cloudOnly = cloudSaves.filter((s) => !localFilenames.has(s.filename));

  // Tombstones surface deletes the user made on another device so this
  // client can mirror them. We send filename + when + where so the client
  // can both delete the local copy and show a friendly "deleted from
  // <Marts Desktop>" hint.
  const tombstones = allCloudSaves
    .filter((s) => s.deletedAt !== null)
    .map((s) => ({
      filename: s.filename,
      deletedAt: s.deletedAt!.toISOString(),
      deletedFrom: s.deletedFrom ?? "",
    }));

  return { actions, cloudOnly, tombstones };
});
