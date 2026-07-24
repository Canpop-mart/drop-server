-- CreateEnum
CREATE TYPE "ArchipelagoSessionStatus" AS ENUM ('Setup', 'Running', 'Closed');

-- CreateTable
CREATE TABLE "ArchipelagoNetwork" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "networkId" TEXT NOT NULL,
    "subnetOctet" INTEGER NOT NULL,
    "serverAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchipelagoNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchipelagoSession" (
    "id" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "name" TEXT,
    "connectAddress" TEXT,
    "status" "ArchipelagoSessionStatus" NOT NULL DEFAULT 'Setup',
    "hostClientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchipelagoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchipelagoSlot" (
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "yamlText" TEXT,
    "slotName" TEXT,
    "game" TEXT,
    "validationError" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchipelagoSlot_pkey" PRIMARY KEY ("sessionId","clientId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchipelagoNetwork_networkId_key" ON "ArchipelagoNetwork"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchipelagoSession_shortCode_key" ON "ArchipelagoSession"("shortCode");

-- CreateIndex
CREATE INDEX "ArchipelagoSession_hostClientId_idx" ON "ArchipelagoSession"("hostClientId");

-- CreateIndex
CREATE INDEX "ArchipelagoSlot_clientId_idx" ON "ArchipelagoSlot"("clientId");

-- AddForeignKey
ALTER TABLE "ArchipelagoSession" ADD CONSTRAINT "ArchipelagoSession_hostClientId_fkey" FOREIGN KEY ("hostClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchipelagoSlot" ADD CONSTRAINT "ArchipelagoSlot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ArchipelagoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchipelagoSlot" ADD CONSTRAINT "ArchipelagoSlot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
