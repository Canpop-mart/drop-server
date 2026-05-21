-- Adds ImportReceipt — the structured, queryable record of a completed
-- version import — plus the per-library `autoEmulatorSetup` flag that
-- gates the whole setupEmulators phase (broader than autoSwapSteamApiDll,
-- which only gates the DLL swap step).

-- Library: default ON preserves historical behaviour (emulator setup
-- always ran during import). Flip OFF to make the setupEmulators phase
-- a full no-op for every game in the library.
ALTER TABLE "Library"
    ADD COLUMN "autoEmulatorSetup" BOOLEAN NOT NULL DEFAULT true;

-- ImportReceipt: one row per successful version import. One-to-one with
-- GameVersion, cascade-deleted with it.
CREATE TABLE "ImportReceipt" (
    "id" TEXT NOT NULL,
    "gameVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "phaseTimingsJson" JSONB NOT NULL,

    "fileCount" INTEGER NOT NULL,
    "totalSizeBytes" BIGINT NOT NULL,
    "chunkCount" INTEGER NOT NULL,

    "dllSwapApplied" BOOLEAN NOT NULL DEFAULT false,
    "dllSwapName" TEXT,

    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ImportReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportReceipt_gameVersionId_key"
    ON "ImportReceipt" ("gameVersionId");

CREATE INDEX "ImportReceipt_gameVersionId_idx"
    ON "ImportReceipt" ("gameVersionId");

ALTER TABLE "ImportReceipt"
    ADD CONSTRAINT "ImportReceipt_gameVersionId_fkey"
    FOREIGN KEY ("gameVersionId") REFERENCES "GameVersion"("versionId")
    ON DELETE CASCADE ON UPDATE CASCADE;
