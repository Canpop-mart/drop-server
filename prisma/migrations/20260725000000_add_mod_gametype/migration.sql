-- Add the Mod value to GameType. Kept in its OWN migration: Postgres cannot use
-- a newly added enum value in the same transaction that adds it, so the column
-- work that follows lives in the next migration.

-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'Mod';
