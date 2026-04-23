-- Add indexes flagged by the April 2026 server audit.
--
-- PostgreSQL does not auto-index foreign key columns (unlike MySQL), so
-- cascade deletes and "list by parent" queries on these columns were
-- previously sequentially scanning the referenced tables. These indexes
-- cover the hot paths; each is BTREE unless noted.
--
-- Notes:
--   * Notification.userId, Screenshot.gameId, and CloudSave.gameId were
--     flagged in the audit but are already covered by existing compound
--     indexes (each starts with the FK column), so they are intentionally
--     omitted here.
--   * `featured` is low-cardinality (mostly false); a plain BTREE still
--     helps on small fractions, and Postgres' planner will ignore it when
--     a query predicate isn't selective enough.
--   * CREATE INDEX (not CONCURRENTLY) because `prisma migrate deploy` runs
--     each migration inside a transaction. On very large deployments (tens
--     of millions of GameVersion rows) operators may prefer to copy these
--     statements to `CREATE INDEX CONCURRENTLY` applied outside Prisma.

-- GameVersion.gameId: cascade delete + "versions for this game" list.
CREATE INDEX "GameVersion_gameId_idx" ON "GameVersion"("gameId");

-- (gameId, versionIndex DESC): "latest version for this game" is the
-- download-path's hottest lookup. DESC ordering lets Postgres serve
-- `ORDER BY versionIndex DESC LIMIT 1` directly from the index.
CREATE INDEX "GameVersion_gameId_versionIndex_idx"
  ON "GameVersion"("gameId", "versionIndex" DESC);

-- Game.featured: landing-page/home queries filter on this.
CREATE INDEX "Game_featured_idx" ON "Game"("featured");
