-- A mod is a Game with parentGameId set (the base game it applies to).

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "parentGameId" TEXT;

-- CreateIndex
CREATE INDEX "Game_parentGameId_idx" ON "Game"("parentGameId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_parentGameId_fkey" FOREIGN KEY ("parentGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
