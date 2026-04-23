-- Add StreamingSession table + StreamingStatus enum
-- Fixes Sunshine 500: the model was added to the schema but no migration was generated,
-- so /api/v1/client/streaming/request returned 500 with empty body when prisma tried to
-- INSERT into a nonexistent table.

-- CreateEnum
CREATE TYPE "StreamingStatus" AS ENUM ('Requested', 'Starting', 'Ready', 'Streaming', 'Stopped');

-- CreateTable
CREATE TABLE "StreamingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hostClientId" TEXT NOT NULL,
    "gameId" TEXT,
    "requestingClientId" TEXT,
    "status" "StreamingStatus" NOT NULL DEFAULT 'Starting',
    "sunshinePort" INTEGER NOT NULL DEFAULT 47989,
    "hostLocalIp" TEXT,
    "hostExternalIp" TEXT,
    "pairingPin" TEXT,
    "gameConfig" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "lastHeartbeat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamingSession_userId_idx" ON "StreamingSession"("userId");

-- CreateIndex
CREATE INDEX "StreamingSession_hostClientId_idx" ON "StreamingSession"("hostClientId");

-- CreateIndex
CREATE INDEX "StreamingSession_status_idx" ON "StreamingSession"("status");

-- AddForeignKey
ALTER TABLE "StreamingSession" ADD CONSTRAINT "StreamingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamingSession" ADD CONSTRAINT "StreamingSession_hostClientId_fkey" FOREIGN KEY ("hostClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamingSession" ADD CONSTRAINT "StreamingSession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamingSession" ADD CONSTRAINT "StreamingSession_requestingClientId_fkey" FOREIGN KEY ("requestingClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
