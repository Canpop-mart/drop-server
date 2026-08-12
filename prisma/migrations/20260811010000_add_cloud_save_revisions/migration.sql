-- D13: server-side version history for cloud saves.
--
-- Uploads upsert `CloudSave` in place, so the previous bytes are destroyed
-- the moment the write commits and no copy exists anywhere else. This table
-- holds the superseded blob so an overwrite can be undone.
--
-- Purely additive: no existing column or row is touched. Saves that predate
-- this migration simply have no history until their next overwrite.
--
--   * `saveId` cascades from CloudSave, so the tombstone GC that hard-deletes
--     a save also reclaims its revisions.
--   * The (saveId, supersededAt) index serves both the prune-to-newest-N
--     write path and the recovery listing.
--   * Column types mirror CloudSave exactly: BYTEA for the blob, TIMESTAMP(3)
--     for the client-reported mtime, TIMESTAMPTZ(6) for server-side stamps.

-- CreateTable
CREATE TABLE "CloudSaveRevision" (
    "id" TEXT NOT NULL,
    "saveId" TEXT NOT NULL,
    "saveType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "dataHash" TEXT NOT NULL DEFAULT '',
    "uploadedFrom" TEXT NOT NULL DEFAULT '',
    "clientModifiedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudSaveRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudSaveRevision_saveId_supersededAt_idx" ON "CloudSaveRevision"("saveId", "supersededAt");

-- AddForeignKey
ALTER TABLE "CloudSaveRevision" ADD CONSTRAINT "CloudSaveRevision_saveId_fkey" FOREIGN KEY ("saveId") REFERENCES "CloudSave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
