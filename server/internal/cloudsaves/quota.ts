import prisma from "~/server/internal/db/database";
import {
  MAX_SAVE_REVISIONS,
  pruneSaveRevisions,
} from "~/server/internal/cloudsaves/revisions";

/**
 * Default per-user cloud-save quota when the User column is unset.
 * 1 GiB. Mirrors the Prisma `@default(1073741824)` on `User.cloudSaveQuotaBytes`.
 */
export const DEFAULT_CLOUD_SAVE_QUOTA_BYTES = 1_073_741_824;

/** GC threshold for tombstoned rows. After this they're hard-deleted. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CloudSaveQuota = {
  /** Sum of `size` across the user's active (non-tombstoned) cloud saves. */
  usedBytes: number;
  /** The user's configured cap. */
  limitBytes: number;
};

/**
 * Compute the user's current quota usage + their configured limit.
 *
 * `_sum.size` is computed at the DB level so we don't materialise blobs.
 * Tombstoned rows are excluded — they still occupy storage but the user's
 * usage figure should match what they perceive as "their saves". The 30-day
 * GC ([`gcTombstones`]) is what reclaims the bytes.
 *
 * Revision blobs are excluded too, deliberately — see
 * [`fetchUserRevisionBytes`] for why and for how to surface them.
 */
export async function fetchUserQuota(userId: string): Promise<CloudSaveQuota> {
  const [user, agg] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { cloudSaveQuotaBytes: true },
    }),
    prisma.cloudSave.aggregate({
      where: { userId, deletedAt: null },
      _sum: { size: true },
    }),
  ]);

  // BigInt → number is safe here: an unrealistically large quota of 2^53
  // bytes is ~9 PB. Anything beyond Number.MAX_SAFE_INTEGER would lose
  // precision but is not a realistic deployment.
  const limitBytes = user
    ? Number(user.cloudSaveQuotaBytes)
    : DEFAULT_CLOUD_SAVE_QUOTA_BYTES;
  const usedBytes = agg._sum.size ?? 0;
  return { usedBytes, limitBytes };
}

/**
 * Cheap helper used by upload paths: get the user's bytes-remaining figure
 * along with the limit (so callers can produce a clear 413 message).
 *
 * Returns `{ usedBytes, limitBytes, remainingBytes }`. `remainingBytes` may
 * be negative if a previous administrative quota reduction brought the user
 * over the new limit — callers should treat negative as "no room".
 */
export async function fetchUserQuotaWithRemaining(
  userId: string,
): Promise<CloudSaveQuota & { remainingBytes: number }> {
  const q = await fetchUserQuota(userId);
  return { ...q, remainingBytes: q.limitBytes - q.usedBytes };
}

/**
 * Total bytes this user's save history occupies.
 *
 * QUOTA DECISION: revision blobs do NOT count against `cloudSaveQuotaBytes`.
 *
 * They're storage the user never asked for, created by a safety net they
 * can't turn off. If they counted, a user near their cap would start getting
 * 413s on the upload path *because* we were protecting their previous
 * upload — the backstop would cause the exact data loss it exists to
 * prevent, and the natural fix (drop the history) is the wrong one.
 *
 * The overhead is bounded structurally rather than by the quota: at most
 * MAX_SAVE_REVISIONS per file, only written when the bytes actually change,
 * each capped by the same 50 MiB per-file limit as a live save, and reaped
 * with the parent by the tombstone GC. Worst case is therefore roughly
 * (1 + MAX_SAVE_REVISIONS)x a full quota of files that all keep changing.
 *
 * This figure is not on the upload hot path — `fetchUserQuota` stays a
 * two-query call. Read it where an operator or the recovery UI wants the
 * real storage picture.
 */
export async function fetchUserRevisionBytes(userId: string): Promise<number> {
  const agg = await prisma.cloudSaveRevision.aggregate({
    where: { save: { userId } },
    _sum: { size: true },
  });
  return agg._sum.size ?? 0;
}

/**
 * Format a byte count for quota-exceeded error messages. Uses GiB/MiB/KiB
 * with one decimal place; matches the style used elsewhere in the upload
 * error surface.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * Compose a quota-exceeded error message in the form
 * "Save quota exceeded: would be 1.20 GiB / 1.00 GiB".
 */
export function quotaExceededMessage(
  projectedBytes: number,
  limitBytes: number,
): string {
  return `Save quota exceeded: would be ${formatBytes(
    projectedBytes,
  )} / ${formatBytes(limitBytes)}`;
}

/**
 * Count what `gcTombstones` would destroy, without destroying it.
 *
 * This exists because the purge has never run in production. Every save the
 * user has ever deleted since the feature shipped is past the retention
 * window, so the first execution hard-deletes all of them in one unattended
 * sweep, and those rows predate CloudSaveRevision so they have no history to
 * fall back on. The operator gets to see the number first.
 */
export async function countTombstonesDue(
  now: Date = new Date(),
): Promise<{ count: number; bytes: number }> {
  const cutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MS);
  const agg = await prisma.cloudSave.aggregate({
    where: { deletedAt: { not: null, lt: cutoff } },
    _count: { _all: true },
    _sum: { size: true },
  });
  return { count: agg._count._all, bytes: agg._sum.size ?? 0 };
}

/**
 * Garbage-collect tombstones older than `TOMBSTONE_RETENTION_MS`.
 *
 * Run through the `cleanup:cloud-saves` task (see
 * `internal/tasks/registry/cleanup-cloud-saves.ts`), which is deliberately
 * NOT on the daily schedule yet; also callable directly from an admin
 * endpoint. Returns the number of rows hard-deleted.
 *
 * Deleting a CloudSave cascades its `CloudSaveRevision` rows, so this
 * reclaims a purged save's history along with it.
 *
 * NOTE: uses `deleteMany` rather than `delete` to satisfy the repo's
 * `drop/no-prisma-delete` lint rule and because we want the rowcount.
 */
export async function gcTombstones(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MS);
  const result = await prisma.cloudSave.deleteMany({
    where: { deletedAt: { not: null, lt: cutoff } },
  });
  return result.count;
}

/**
 * Re-assert the newest-N invariant across every save's history.
 *
 * The upload path already prunes as it writes, so in a healthy server this
 * finds nothing. It's here to mop up the cases the write path can't: two
 * uploads racing on one file each snapshotting the same version, and any
 * history left behind by a future change to MAX_SAVE_REVISIONS.
 *
 * Count-based only. Revisions are deliberately NOT aged out — a save you
 * haven't touched in a year still deserves its three previous versions, and
 * expiring them would quietly remove the safety net at the moment it's least
 * likely to be missed and most likely to be needed.
 *
 * Returns the number of surplus revisions deleted.
 */
export async function gcSaveRevisions(): Promise<number> {
  const overflowing = await prisma.cloudSaveRevision.groupBy({
    by: ["saveId"],
    _count: { _all: true },
    having: { saveId: { _count: { gt: MAX_SAVE_REVISIONS } } },
  });

  let deleted = 0;
  for (const { saveId } of overflowing) {
    deleted += await pruneSaveRevisions(prisma, saveId);
  }
  return deleted;
}
