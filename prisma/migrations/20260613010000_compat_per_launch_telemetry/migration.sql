-- Per-launch compatibility telemetry.
--
-- Extends GameCompatibilityResult so results can be attributed to a specific
-- build (multiplayer parity / per-version compat), carry a multiplayer-specific
-- outcome, and record whether they came from the test worker or a real user
-- launch auto-reporting its outcome.

ALTER TABLE "GameCompatibilityResult" ADD COLUMN "gameVersionId" TEXT;
ALTER TABLE "GameCompatibilityResult" ADD COLUMN "multiplayerOk" BOOLEAN;
ALTER TABLE "GameCompatibilityResult" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'worker';

ALTER TABLE "GameCompatibilityResult"
  ADD CONSTRAINT "GameCompatibilityResult_gameVersionId_fkey"
  FOREIGN KEY ("gameVersionId") REFERENCES "GameVersion"("versionId")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GameCompatibilityResult_gameVersionId_idx" ON "GameCompatibilityResult"("gameVersionId");
