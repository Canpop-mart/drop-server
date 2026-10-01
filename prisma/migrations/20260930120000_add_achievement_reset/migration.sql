-- Achievement resets that survive the next launch.
--
-- Deleting a user's UserAchievement rows is not enough on its own: the
-- client's emulator save file and RetroAchievements still report those
-- unlocks, so they came straight back on the next session. This table records
-- when the user reset a game; unlocks earned before `resetAt` are ignored by
-- every write path.
--
-- Purely additive. One row per (user, game); both sides cascade on delete.

-- CreateTable
CREATE TABLE "AchievementReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AchievementReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AchievementReset_userId_gameId_key" ON "AchievementReset"("userId", "gameId");

-- CreateIndex
CREATE INDEX "AchievementReset_gameId_idx" ON "AchievementReset"("gameId");

-- AddForeignKey
ALTER TABLE "AchievementReset" ADD CONSTRAINT "AchievementReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementReset" ADD CONSTRAINT "AchievementReset_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
