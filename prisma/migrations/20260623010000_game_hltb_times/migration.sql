-- HowLongToBeat completion times (minutes), best-effort enrichment at import.
ALTER TABLE "Game" ADD COLUMN "mHltbMain" INTEGER;
ALTER TABLE "Game" ADD COLUMN "mHltbMainSides" INTEGER;
ALTER TABLE "Game" ADD COLUMN "mHltbCompletionist" INTEGER;
