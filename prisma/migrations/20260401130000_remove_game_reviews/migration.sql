-- DropForeignKey
ALTER TABLE "GameReview" DROP CONSTRAINT IF EXISTS "GameReview_gameId_fkey";
ALTER TABLE "GameReview" DROP CONSTRAINT IF EXISTS "GameReview_userId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "GameReview_gameId_userId_key";
DROP INDEX IF EXISTS "GameReview_gameId_idx";
DROP INDEX IF EXISTS "GameReview_userId_idx";
DROP INDEX IF EXISTS "GameReview_createdAt_idx";
DROP INDEX IF EXISTS "GameReview_rating_idx";

-- DropTable
DROP TABLE IF EXISTS "GameReview";

-- Remove 'Review' from ShowcaseType enum
-- Postgres requires creating a new enum type without the value
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShowcaseType') THEN
    -- Only remove if no rows reference 'Review'
    UPDATE "ProfileShowcase" SET "type" = 'Custom' WHERE "type" = 'Review';
    -- Create replacement enum without 'Review'
    CREATE TYPE "ShowcaseType_new" AS ENUM ('FavoriteGame', 'Achievement', 'GameStats', 'Custom');
    ALTER TABLE "ProfileShowcase" ALTER COLUMN "type" TYPE "ShowcaseType_new" USING ("type"::text::"ShowcaseType_new");
    DROP TYPE "ShowcaseType";
    ALTER TYPE "ShowcaseType_new" RENAME TO "ShowcaseType";
  END IF;
END $$;
