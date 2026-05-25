import prisma from "~/server/internal/db/database";

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
 * Garbage-collect tombstones older than `TOMBSTONE_RETENTION_MS`.
 *
 * Intentionally not wired to a cron. Call this from an admin endpoint or
 * scheduled task. Returns the number of rows hard-deleted.
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
