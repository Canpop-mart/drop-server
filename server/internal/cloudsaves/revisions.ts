import type prisma from "~/server/internal/db/database";
import type { Prisma } from "~/prisma/client/client";

/**
 * How many superseded versions we keep per (gameId, userId, filename).
 *
 * Three is enough to survive the realistic failure: a bad sync round-trips
 * a save two or three times in quick succession before anyone notices, and
 * the user needs to reach back past all of them. Keeping more would grow
 * unbounded blob storage for a case nobody has ever asked for.
 */
export const MAX_SAVE_REVISIONS = 3;

/**
 * Transaction options for a snapshot + write pair.
 *
 * Prisma's interactive-transaction default is a 5s timeout, which is fine
 * for the row-sized transactions elsewhere in the codebase but not here: a
 * single save can be 50 MiB, and this transaction reads that blob, writes a
 * copy of it, and writes the replacement. On NAS-backed Postgres that can
 * outrun 5s, and the failure mode is a rejected upload.
 */
export const SAVE_WRITE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

/** The subset of the parent row a revision copies. */
const REVISION_SOURCE_FIELDS = {
  id: true,
  saveType: true,
  size: true,
  data: true,
  dataHash: true,
  uploadedFrom: true,
  clientModifiedAt: true,
} as const;

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Copy a save row's current bytes into a revision, then prune that save's
 * history back to the newest MAX_SAVE_REVISIONS.
 *
 * MUST be called with `tx` inside the same transaction as the write that
 * overwrites the row. If the snapshot and the overwrite could commit
 * separately, a crash between them loses the old bytes — which is the exact
 * failure this whole table exists to prevent.
 *
 * No-ops when there is nothing to preserve:
 *   - the row doesn't exist yet (a create, not an overwrite), or
 *   - `nextHash` matches what's already stored, so the write changes no
 *     bytes and a revision would just be a duplicate blob.
 *
 * A tombstoned row IS snapshotted. Its bytes are still the user's last good
 * copy, and an upload revives the row rather than replacing a blank.
 *
 * Returns the revision id, or null when nothing was written.
 *
 * Concurrency: two uploads racing on the same file under READ COMMITTED can
 * each snapshot the same previous version, producing a duplicate revision.
 * That costs storage, never data, so we don't take a row lock for it — the
 * prune trims the surplus on the next write anyway.
 */
export async function snapshotSaveRevision(
  tx: DbClient,
  where: { gameId: string; userId: string; filename: string },
  nextHash: string,
): Promise<string | null> {
  const current = await tx.cloudSave.findUnique({
    where: { gameId_userId_filename: where },
    select: REVISION_SOURCE_FIELDS,
  });
  if (!current) return null;
  if (current.dataHash && current.dataHash === nextHash) return null;

  const revision = await tx.cloudSaveRevision.create({
    data: {
      saveId: current.id,
      saveType: current.saveType,
      size: current.size,
      data: current.data,
      dataHash: current.dataHash,
      uploadedFrom: current.uploadedFrom,
      clientModifiedAt: current.clientModifiedAt,
    },
    select: { id: true },
  });

  await pruneSaveRevisions(tx, current.id);

  return revision.id;
}

/**
 * Trim one save's history to the newest MAX_SAVE_REVISIONS.
 *
 * Ordered by supersededAt then id so the ordering is total — two revisions
 * written inside the same transaction share a timestamp, and an unstable
 * sort there could drop the wrong one.
 */
export async function pruneSaveRevisions(
  tx: DbClient,
  saveId: string,
): Promise<number> {
  const surplus = await tx.cloudSaveRevision.findMany({
    where: { saveId },
    orderBy: [{ supersededAt: "desc" }, { id: "desc" }],
    skip: MAX_SAVE_REVISIONS,
    select: { id: true },
  });
  if (surplus.length === 0) return 0;

  const result = await tx.cloudSaveRevision.deleteMany({
    where: { id: { in: surplus.map((r) => r.id) } },
  });
  return result.count;
}
