-- In-place game updates: per-version mirrored folders.
--
-- GameVersion.mirrorFolders lists folders, relative to the version root, that
-- players' installs are made to match exactly when they update. Every
-- existing row gets an empty list, which means no mirroring, so nothing
-- changes for existing versions until an admin sets some.
--
-- Purely additive.

-- AlterTable
ALTER TABLE "GameVersion" ADD COLUMN "mirrorFolders" TEXT[] DEFAULT ARRAY[]::TEXT[];
