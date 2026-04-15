-- CreateTable
CREATE TABLE "CloudSave" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "saveType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "clientModifiedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CloudSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudSave_gameId_userId_filename_key" ON "CloudSave"("gameId", "userId", "filename");

-- CreateIndex
CREATE INDEX "CloudSave_gameId_userId_idx" ON "CloudSave"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "CloudSave" ADD CONSTRAINT "CloudSave_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudSave" ADD CONSTRAINT "CloudSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
