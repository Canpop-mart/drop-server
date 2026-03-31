-- CreateEnum
CREATE TYPE "ExternalAccountProvider" AS ENUM ('Steam', 'RetroAchievements', 'Goldberg');

-- CreateTable
CREATE TABLE "UserExternalAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ExternalAccountProvider" NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "UserExternalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameExternalLink" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "provider" "ExternalAccountProvider" NOT NULL,
    "externalGameId" TEXT NOT NULL,

    CONSTRAINT "GameExternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "provider" "ExternalAccountProvider" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconUrl" TEXT NOT NULL DEFAULT '',
    "iconLockedUrl" TEXT NOT NULL DEFAULT '',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserExternalAccount_provider_externalId_idx" ON "UserExternalAccount"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "UserExternalAccount_userId_provider_key" ON "UserExternalAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "GameExternalLink_gameId_provider_key" ON "GameExternalLink"("gameId", "provider");

-- CreateIndex
CREATE INDEX "Achievement_gameId_idx" ON "Achievement"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_gameId_provider_externalId_key" ON "Achievement"("gameId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- AddForeignKey
ALTER TABLE "UserExternalAccount" ADD CONSTRAINT "UserExternalAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameExternalLink" ADD CONSTRAINT "GameExternalLink_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
