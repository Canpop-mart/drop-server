-- AlterTable: Add consoleId to GameExternalLink
ALTER TABLE "GameExternalLink" ADD COLUMN "consoleId" INTEGER;

-- CreateTable
CREATE TABLE "GameExternalHash" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "provider" "ExternalAccountProvider" NOT NULL,
    "hash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "patchUrl" TEXT NOT NULL DEFAULT '',
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameExternalHash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameExternalHash_gameId_idx" ON "GameExternalHash"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameExternalHash_gameId_provider_hash_key" ON "GameExternalHash"("gameId", "provider", "hash");

-- AddForeignKey
ALTER TABLE "GameExternalHash" ADD CONSTRAINT "GameExternalHash_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
