-- AlterTable: add gamerscore points + global unlock-rarity % to achievements.
-- `points` is RetroAchievements/Xbox-style (0 for Steam). `globalPercent` is the
-- global unlock rarity in [0,100] from RetroAchievements and Steam's official
-- global-percentages API; NULL when unknown.
ALTER TABLE "Achievement" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Achievement" ADD COLUMN "globalPercent" DOUBLE PRECISION;
