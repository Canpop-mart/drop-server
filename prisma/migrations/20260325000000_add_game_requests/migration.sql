-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('Pending', 'Approved', 'Denied', 'Withdrawn');

-- CreateTable
CREATE TABLE "GameRequest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "igdbUrl" TEXT,
    "steamUrl" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'Pending',
    "reviewNotes" TEXT,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "GameRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameRequest_status_idx" ON "GameRequest"("status");

-- CreateIndex
CREATE INDEX "GameRequest_requesterId_idx" ON "GameRequest"("requesterId");

-- CreateIndex
CREATE INDEX "GameRequest_createdAt_idx" ON "GameRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
