-- CreateEnum (safe: only if not already present)
DO $$ BEGIN
  CREATE TYPE "LeaderboardType" AS ENUM ('Playtime', 'AchievementCount', 'Speedrun', 'Score');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SortOrder" AS ENUM ('Asc', 'Desc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BadgeType" AS ENUM ('Achievement', 'Playtime', 'Collection', 'Review', 'Admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VoteType" AS ENUM ('Up', 'Down');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ShowcaseType" AS ENUM ('FavoriteGame', 'Achievement', 'Review', 'GameStats', 'Custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: PlaySession
CREATE TABLE IF NOT EXISTS "PlaySession" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),
    "durationSeconds" INTEGER,

    CONSTRAINT "PlaySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlaySession_gameId_userId_idx" ON "PlaySession"("gameId", "userId");
CREATE INDEX IF NOT EXISTS "PlaySession_userId_idx" ON "PlaySession"("userId");

-- AddForeignKey (safe)
DO $$ BEGIN
  ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: GameReview
CREATE TABLE IF NOT EXISTS "GameReview" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT DEFAULT '',
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "unhelpful" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GameReview_gameId_userId_key" ON "GameReview"("gameId", "userId");
CREATE INDEX IF NOT EXISTS "GameReview_gameId_idx" ON "GameReview"("gameId");
CREATE INDEX IF NOT EXISTS "GameReview_userId_idx" ON "GameReview"("userId");
CREATE INDEX IF NOT EXISTS "GameReview_createdAt_idx" ON "GameReview"("createdAt");
CREATE INDEX IF NOT EXISTS "GameReview_rating_idx" ON "GameReview"("rating");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "GameReview" ADD CONSTRAINT "GameReview_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GameReview" ADD CONSTRAINT "GameReview_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: Leaderboard
CREATE TABLE IF NOT EXISTS "Leaderboard" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LeaderboardType" NOT NULL,
    "sortOrder" "SortOrder" NOT NULL DEFAULT 'Desc',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Leaderboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Leaderboard_gameId_name_key" ON "Leaderboard"("gameId", "name");
CREATE INDEX IF NOT EXISTS "Leaderboard_gameId_idx" ON "Leaderboard"("gameId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Leaderboard" ADD CONSTRAINT "Leaderboard_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: LeaderboardEntry
CREATE TABLE IF NOT EXISTS "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "leaderboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,
    "rank" INTEGER,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeaderboardEntry_leaderboardId_userId_key" ON "LeaderboardEntry"("leaderboardId", "userId");
CREATE INDEX IF NOT EXISTS "LeaderboardEntry_leaderboardId_idx" ON "LeaderboardEntry"("leaderboardId");
CREATE INDEX IF NOT EXISTS "LeaderboardEntry_userId_idx" ON "LeaderboardEntry"("userId");
CREATE INDEX IF NOT EXISTS "LeaderboardEntry_score_idx" ON "LeaderboardEntry"("score");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_leaderboardId_fkey"
    FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: UserBadge
CREATE TABLE IF NOT EXISTS "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BadgeType" NOT NULL,
    "data" JSONB,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBadge_userId_idx" ON "UserBadge"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
