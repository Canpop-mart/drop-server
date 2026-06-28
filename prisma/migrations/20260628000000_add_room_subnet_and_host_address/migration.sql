-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "subnetOctet" INTEGER,
ADD COLUMN     "hostAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_subnetOctet_key" ON "Room"("subnetOctet");
