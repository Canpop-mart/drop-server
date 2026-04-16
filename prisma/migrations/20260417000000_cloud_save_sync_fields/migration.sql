-- Add sync-related fields to CloudSave for conflict detection

-- MD5 hash of save data for cross-machine comparison without full download
ALTER TABLE "CloudSave" ADD COLUMN "dataHash" TEXT NOT NULL DEFAULT '';

-- Machine identifier shown in conflict resolution UI
ALTER TABLE "CloudSave" ADD COLUMN "uploadedFrom" TEXT NOT NULL DEFAULT '';
