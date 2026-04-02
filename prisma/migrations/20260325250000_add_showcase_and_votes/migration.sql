-- CreateEnum: ShowcaseType
DO $$ BEGIN
  CREATE TYPE "ShowcaseType" AS ENUM ('FavoriteGame', 'Achievement', 'Review', 'GameStats', 'Custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: VoteType
DO $$ BEGIN
  CREATE TYPE "VoteType" AS ENUM ('Up', 'Down');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: ProfileShowcase
CREATE TABLE IF NOT EXISTS "ProfileShowcase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ShowcaseType" NOT NULL,
    "gameId" TEXT,
    "itemId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProfileShowcase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfileShowcase_userId_idx" ON "ProfileShowcase"("userId");
CREATE INDEX IF NOT EXISTS "ProfileShowcase_sortOrder_idx" ON "ProfileShowcase"("sortOrder");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfileShowcase" ADD CONSTRAINT "ProfileShowcase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProfileShowcase" ADD CONSTRAINT "ProfileShowcase_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: RequestVote
CREATE TABLE IF NOT EXISTS "RequestVote" (
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" "VoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestVote_pkey" PRIMARY KEY ("requestId", "userId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequestVote_requestId_idx" ON "RequestVote"("requestId");
CREATE INDEX IF NOT EXISTS "RequestVote_userId_idx" ON "RequestVote"("userId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RequestVote" ADD CONSTRAINT "RequestVote_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "GameRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RequestVote" ADD CONSTRAINT "RequestVote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
