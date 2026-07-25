-- Move mod placement from the base Game to the mod's GameVersion, so each
-- version declares its own install location + optional launch override.

-- AlterTable: per-version placement
ALTER TABLE "GameVersion" ADD COLUMN "modInstallDir" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GameVersion" ADD COLUMN "launchOverride" TEXT;

-- DropColumn: the base-game fields these replace (added in 20260725100000)
ALTER TABLE "Game" DROP COLUMN "modRoot";
ALTER TABLE "Game" DROP COLUMN "launchOverride";
