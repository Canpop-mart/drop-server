-- Persist each version's immutable FULL install/download size (bytes) so the
-- client version-list endpoint reads a column instead of re-parsing the droplet
-- manifest on every request. Nullable: existing rows backfill lazily on first
-- size lookup.

ALTER TABLE "GameVersion" ADD COLUMN "installSize" BIGINT;
ALTER TABLE "GameVersion" ADD COLUMN "downloadSize" BIGINT;
