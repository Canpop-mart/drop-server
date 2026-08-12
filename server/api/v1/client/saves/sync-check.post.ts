import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  SHARED_SAVE_TYPE,
  collapseByFilename,
  isPcNamespacedFilename,
} from "~/server/internal/cloudsaves/scope";

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
 *       uploadedAt: string,
 *       ownedBy: string         // display name of the account holding the row
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
 *     uploadedAt: string,
 *     ownedBy: string,
 *     shadowedSaveId: string | null,  // the caller's own row, if it lost
 *     alsoHeldBy: string[]            // other accounts holding this filename
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
 *
 * SCOPE: emulator saves are read per user; PC saves are read across every
 * account on this server. See `internal/cloudsaves/scope.ts` for why, and
 * note the deliberate asymmetry — the tombstone array below stays strictly
 * per user, so one account's delete can never make another account's client
 * unlink a local file.
 */
/** Strip ownership internals; the client gets a name, never a user id. */
function publicRow(collapsed: {
  winner: {
    id: string;
    user: { displayName: string };
    filename: string;
    saveType: string;
    dataHash: string;
    size: number;
    uploadedFrom: string;
    clientModifiedAt: Date;
    uploadedAt: Date;
  };
  shadowedOwn: { id: string } | null;
  alsoHeldBy: string[];
}) {
  const s = collapsed.winner;
  return {
    id: s.id,
    filename: s.filename,
    saveType: s.saveType,
    dataHash: s.dataHash,
    size: s.size,
    uploadedFrom: s.uploadedFrom,
    clientModifiedAt: s.clientModifiedAt,
    uploadedAt: s.uploadedAt,
    // Display name, never the user id: with PC saves shared across accounts,
    // "newest wins" is only legible if the row says whose copy won.
    ownedBy: s.user.displayName,
    // The caller's own row for this filename when it lost the collision. It
    // used to disappear from every read surface its owner had, which took
    // their revision history and point-in-time restore with it.
    shadowedSaveId: collapsed.shadowedOwn?.id ?? null,
    // Other accounts holding this filename. A second copy of a save must never
    // be invisible, least of all when a clock skew is what decided the winner.
    alsoHeldBy: collapsed.alsoHeldBy,
  };
}

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

  // Two reads, deliberately different in scope.
  //
  // `ownRows` — every row this user owns for this game, metadata only,
  // tombstones included. It is NOT narrowed to the emulator save types: the
  // user's own PC rows come back through `sharedPcRows` for the active set,
  // but their own PC tombstones still belong in the cascade below.
  //
  // `sharedPcRows` — every account's active PC saves for this game, because
  // Drop finds PC saves by where the game writes them on the machine rather
  // than by who is signed in.
  const [ownRows, sharedPcRows] = await Promise.all([
    prisma.cloudSave.findMany({
      where: { gameId, userId },
      select: {
        id: true,
        userId: true,
        user: { select: { displayName: true } },
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
    }),
    prisma.cloudSave.findMany({
      where: { gameId, saveType: SHARED_SAVE_TYPE, deletedAt: null },
      select: {
        id: true,
        userId: true,
        user: { select: { displayName: true } },
        filename: true,
        saveType: true,
        dataHash: true,
        size: true,
        uploadedFrom: true,
        clientModifiedAt: true,
        uploadedAt: true,
      },
    }),
  ]);

  // Active rows feed the normal conflict-detection path; tombstoned rows feed
  // the `tombstones` array and are otherwise invisible to the client. Own PC
  // rows are dropped from the first list because `sharedPcRows` already
  // carries them — including them twice would make a row fight itself for the
  // filename slot.
  //
  // COLLISION RULE: the client keys everything on the filename, so two
  // accounts holding the same PC filename have to collapse to one row. The
  // newest `clientModifiedAt` wins — most recently played session, most
  // current progress. See `collapseByFilename` for the tie-breaks, and for why
  // the loser still comes back on the winner as `shadowedSaveId`.
  //
  // `saveType` is client-supplied and no endpoint checks that the uploader
  // owns the game, so a foreign "pc" row is only shared if its filename also
  // carries the client's PC namespace. Without that gate an account could
  // plant a row named like an emulator save against an emulator game's id and
  // have this launch write it into the launching account's own save directory.
  const cloudSaves = collapseByFilename(
    [
      ...ownRows.filter(
        (s) => s.deletedAt === null && s.saveType !== SHARED_SAVE_TYPE,
      ),
      ...sharedPcRows.filter(
        (s) => s.userId === userId || isPcNamespacedFilename(s.filename),
      ),
    ],
    userId,
  ).map(publicRow);

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
  //
  // Sourced from `ownRows` alone, never from `sharedPcRows`. Deleting a
  // shared PC save is a per-account act: it removes your row, and if another
  // account still holds an active row for that filename it stays in
  // `cloudSaves` above and the save comes back on a later sync. Cascading
  // another account's delete into this client's filesystem would be the one
  // thing shared reads must never buy us.
  const tombstones = ownRows
    .filter((s) => s.deletedAt !== null)
    .map((s) => ({
      filename: s.filename,
      deletedAt: s.deletedAt!.toISOString(),
      deletedFrom: s.deletedFrom ?? "",
    }));

  return { actions, cloudOnly, tombstones };
});
