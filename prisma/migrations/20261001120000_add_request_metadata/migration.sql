-- Game requests remember which game they point at.
--
-- metadataSource / metadataId / metadataName are filled from the requester's
-- provider pick when a request is created and overwritten by the admin's pick
-- on approve. They let the server reject duplicate requests and link a request
-- to its game automatically when that game is imported.
--
-- Purely additive and nullable. Existing rows are left as they are; approvals
-- made before this migration keep their metadata in reviewNotes as JSON and
-- the server still reads it from there.

-- AlterTable
ALTER TABLE "GameRequest" ADD COLUMN     "metadataId" TEXT,
ADD COLUMN     "metadataName" TEXT,
ADD COLUMN     "metadataSource" "MetadataSource";

-- CreateIndex
CREATE INDEX "GameRequest_metadataSource_metadataId_idx" ON "GameRequest"("metadataSource", "metadataId");
