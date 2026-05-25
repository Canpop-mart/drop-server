-- T4 / T5: per-user cloud-save quota + tombstone soft-deletes.
--
-- This migration adds the schema scaffolding for:
--   * `User.cloudSaveQuotaBytes`  — per-user storage cap (default 1 GiB).
--     Stored as BIGINT so future raises beyond INT32_MAX (~2 GiB) work
--     without another migration.
--   * `CloudSave.deletedAt`       — soft-delete timestamp. NULL = active.
--   * `CloudSave.deletedFrom`     — hostname / friendly device name that
--                                   initiated the delete (surfaced in the
--                                   "deleted from <device>" UI hint).
--   * Composite index on (userId, deletedAt) — supports the hot quota
--     aggregate (`SUM(size) WHERE userId = ? AND deletedAt IS NULL`) and
--     the GC sweep over tombstones.

-- Per-user quota cap. Default 1 GiB = 1_073_741_824 bytes.
ALTER TABLE "User"
  ADD COLUMN "cloudSaveQuotaBytes" BIGINT NOT NULL DEFAULT 1073741824;

-- Tombstone metadata for cross-device delete propagation.
ALTER TABLE "CloudSave"
  ADD COLUMN "deletedAt"   TIMESTAMPTZ(6),
  ADD COLUMN "deletedFrom" TEXT;

-- Quota aggregate hot path + tombstone GC sweep cover index.
CREATE INDEX "CloudSave_userId_deletedAt_idx"
  ON "CloudSave"("userId", "deletedAt");
