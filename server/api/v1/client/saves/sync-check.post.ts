import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { cloudSaveFilename } from "~/server/internal/cloudsaves/filename";

/**
 * POST /api/v1/client/saves/sync-check
 *
 * Pre-launch conflict detection. The client sends its local save state;
 * the server compares against cloud and returns one of four verdicts
 * per file: "download", "upload", "conflict" or "synced".
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
 *     filename: string,        // the name the client sent, unchanged
 *     action: "download" | "upload" | "conflict" | "synced",
 *     cloudSave?: {             // present for download/conflict/synced
 *       id, filename, saveType, dataHash, size, clientModifiedAt,
 *       uploadedFrom: string,   // device that uploaded the cloud copy
 *       uploadedAt: string,
 *       ownedBy: string,        // display name of the account it belongs to
 *       shadowedSaveId: null,   // always null now; kept for older clients
 *       alsoHeldBy: []          // always empty now; kept for older clients
 *     },
 *     localHash?: string        // echoed back for client convenience
 *   }],
 *   cloudOnly: [ ...same shape as cloudSave ],  // in the cloud, not local
 *   tombstones: [{              // saves the user deleted on some device
 *     filename: string,         // client deletes its local copy of this file
 *     deletedAt: string,        // ISO timestamp of the soft-delete
 *     deletedFrom: string,      // device name, for display
 *     deletedFromClientId: string | null  // device id, for matching
 *   }]
 * }
 *
 * "conflict" means only that the two hashes differ. The server has no record
 * of what either side looked like at the last sync, so it cannot tell "only
 * the cloud changed" from "both changed". The client can (its sync manifest
 * keeps the hash both sides last agreed on) and downgrades a conflict to a
 * plain download or upload when only one side moved.
 *
 * Filenames are compared after `cloudSaveFilename`, the same sanitizing the
 * upload endpoints store them under. Comparing the raw name meant a save whose
 * name sanitizing changes never matched its own row.
 *
 * SCOPE: strictly the caller's own rows, every save type alike. See
 * `internal/cloudsaves/scope.ts`.
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

  // Every row this user owns for this game, metadata only, tombstones
  // included: active rows feed the verdicts, tombstoned ones the
  // `tombstones` array.
  const ownRows = await prisma.cloudSave.findMany({
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
      deletedFromClientId: true,
    },
  });

  const cloudSaves = ownRows
    .filter((s) => s.deletedAt === null)
    .map((s) => ({
      id: s.id,
      filename: s.filename,
      saveType: s.saveType,
      dataHash: s.dataHash,
      size: s.size,
      uploadedFrom: s.uploadedFrom,
      clientModifiedAt: s.clientModifiedAt,
      uploadedAt: s.uploadedAt,
      // The conflict prompt names whose cloud copy this is. Two Drop accounts
      // on one PC share that PC's save files on disk, so "the cloud copy" is
      // only unambiguous with an owner attached.
      ownedBy: user.displayName,
      shadowedSaveId: null,
      alsoHeldBy: [] as string[],
    }));

  const cloudByFilename = new Map(cloudSaves.map((s) => [s.filename, s]));
  const localCloudNames = new Set<string>();

  const actions: Array<{
    filename: string;
    action: "download" | "upload" | "conflict" | "synced";
    cloudSave?: (typeof cloudSaves)[number];
    localHash?: string;
  }> = [];

  for (const local of localSaves as Array<{
    filename: string;
    dataHash: string;
  }>) {
    const cloudName = cloudSaveFilename(String(local.filename ?? ""));
    localCloudNames.add(cloudName);
    const cloud = cloudByFilename.get(cloudName);

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
      actions.push({
        filename: local.filename,
        action: "synced",
        cloudSave: cloud,
        localHash: local.dataHash,
      });
      continue;
    }

    // A row from before hashes were stored: nothing to compare, so the local
    // copy is pushed.
    if (!cloud.dataHash) {
      actions.push({
        filename: local.filename,
        action: "upload",
        cloudSave: cloud,
        localHash: local.dataHash,
      });
      continue;
    }

    actions.push({
      filename: local.filename,
      action: "conflict",
      cloudSave: cloud,
      localHash: local.dataHash,
    });
  }

  const cloudOnly = cloudSaves.filter((s) => !localCloudNames.has(s.filename));

  // Tombstones surface deletes the user made on another device so this
  // client can mirror them. `deletedFromClientId` is how a device recognises
  // its own delete; the name is for the "deleted from <device>" hint.
  const tombstones = ownRows
    .filter((s) => s.deletedAt !== null)
    .map((s) => ({
      filename: s.filename,
      deletedAt: s.deletedAt!.toISOString(),
      deletedFrom: s.deletedFrom ?? "",
      deletedFromClientId: s.deletedFromClientId,
    }));

  return { actions, cloudOnly, tombstones };
});
