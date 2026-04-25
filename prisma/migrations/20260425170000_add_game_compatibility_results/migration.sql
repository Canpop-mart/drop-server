-- Add GameCompatibilityResult table + GameCompatibilityStatus enum
-- Phase A of the compatibility-testing feature: lets clients (Steam Deck,
-- Windows PC) report whether each game in the library actually launches and
-- renders. One row per test run; latest row per (gameId, clientId) is the
-- current state.

-- CreateEnum
CREATE TYPE "GameCompatibilityStatus" AS ENUM (
    'untested',
    'installing',
    'testing',
    'alive_renders',
    'alive_no_render',
    'early_exit',
    'crash',
    'no_launch',
    'install_failed'
);

-- CreateTable
CREATE TABLE "GameCompatibilityResult" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "GameCompatibilityStatus" NOT NULL,
    "signature" TEXT,
    "protonVersion" TEXT,
    "notes" TEXT,
    "logExcerpt" TEXT,
    "testedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameCompatibilityResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: "latest result for this game on this client"
CREATE INDEX "GameCompatibilityResult_gameId_clientId_testedAt_idx"
    ON "GameCompatibilityResult"("gameId", "clientId", "testedAt" DESC);

-- CreateIndex: "give me everything this client has tested" (worker queries)
CREATE INDEX "GameCompatibilityResult_clientId_status_testedAt_idx"
    ON "GameCompatibilityResult"("clientId", "status", "testedAt" DESC);

-- CreateIndex: dashboard rollups by status
CREATE INDEX "GameCompatibilityResult_status_idx"
    ON "GameCompatibilityResult"("status");

-- AddForeignKey
ALTER TABLE "GameCompatibilityResult"
    ADD CONSTRAINT "GameCompatibilityResult_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCompatibilityResult"
    ADD CONSTRAINT "GameCompatibilityResult_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
