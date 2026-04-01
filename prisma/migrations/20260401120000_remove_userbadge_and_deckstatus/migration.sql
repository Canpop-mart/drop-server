-- DropForeignKey
ALTER TABLE "UserBadge" DROP CONSTRAINT IF EXISTS "UserBadge_userId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "UserBadge_userId_idx";

-- DropTable
DROP TABLE IF EXISTS "UserBadge";

-- DropEnum
DROP TYPE IF EXISTS "BadgeType";

-- DropEnum (never migrated to DB, but clean up if present)
DROP TYPE IF EXISTS "DeckStatus";

-- AlterTable: remove deckVerified from LaunchConfiguration (never migrated, but clean up if present)
DO $$ BEGIN
  ALTER TABLE "LaunchConfiguration" DROP COLUMN IF EXISTS "deckVerified";
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
