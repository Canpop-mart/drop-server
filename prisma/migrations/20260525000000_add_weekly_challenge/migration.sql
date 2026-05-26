-- Creates the WeeklyChallenge table introduced in drop-app v3.4.0 for the
-- "Your weekly quest" feature on the community page. One row per week,
-- selected from a pool of 9 personal quest kinds; the optional FK to
-- GameTag is set only for the `genre_focus` kind (where the description
-- interpolates the tag name).
--
-- CreateTable
CREATE TABLE "WeeklyChallenge" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMPTZ(6) NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "tagId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyChallenge_weekStart_key" ON "WeeklyChallenge"("weekStart");

-- AddForeignKey
ALTER TABLE "WeeklyChallenge" ADD CONSTRAINT "WeeklyChallenge_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "GameTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
