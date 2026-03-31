-- Add banner, theme to User
ALTER TABLE "User" ADD COLUMN "bannerObjectId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "profileTheme" TEXT NOT NULL DEFAULT 'default';

-- Create FavoriteGame table
CREATE TABLE "FavoriteGame" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteGame_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "FavoriteGame_userId_gameId_key" ON "FavoriteGame"("userId", "gameId");
CREATE INDEX "FavoriteGame_userId_idx" ON "FavoriteGame"("userId");

-- Add foreign keys
ALTER TABLE "FavoriteGame" ADD CONSTRAINT "FavoriteGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteGame" ADD CONSTRAINT "FavoriteGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
