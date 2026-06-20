-- CreateEnum
CREATE TYPE "RoomMemberStatus" AS ENUM ('Pending', 'Authorized', 'Left');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "gameId" TEXT,
    "name" TEXT,
    "hostClientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "roomId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "RoomMemberStatus" NOT NULL DEFAULT 'Authorized',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("roomId","clientId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_networkId_key" ON "Room"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_shortCode_key" ON "Room"("shortCode");

-- CreateIndex
CREATE INDEX "Room_hostClientId_idx" ON "Room"("hostClientId");

-- CreateIndex
CREATE INDEX "Room_expiresAt_idx" ON "Room"("expiresAt");

-- CreateIndex
CREATE INDEX "RoomMember_clientId_idx" ON "RoomMember"("clientId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hostClientId_fkey" FOREIGN KEY ("hostClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
