-- In-place game updates: per-version content revisions with per-file hashes.
--
-- GameVersion.revision starts at 1 for every existing row. The matching
-- GameVersionRevision snapshot (one row per version and revision, holding
-- { path, size, sha256 } for every file) is written later, when an admin
-- presses "Record fingerprints" or "Check for changes" on the version.
--
-- GameVersionRevision has no foreign key to GameVersion on purpose: clients
-- may still need an old revision as their baseline after the version row is
-- deleted. It cascades only when the whole game is deleted.
--
-- Purely additive.

-- AlterTable
ALTER TABLE "GameVersion" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "GameVersionRevision" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "files" JSONB NOT NULL,
    "fileStats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameVersionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameVersionRevision_versionId_revision_key" ON "GameVersionRevision"("versionId", "revision");

-- CreateIndex
CREATE INDEX "GameVersionRevision_gameId_idx" ON "GameVersionRevision"("gameId");

-- AddForeignKey
ALTER TABLE "GameVersionRevision" ADD CONSTRAINT "GameVersionRevision_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
