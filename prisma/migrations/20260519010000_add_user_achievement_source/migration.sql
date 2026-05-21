-- Adds UserAchievement.source — provenance for which write path recorded
-- an unlock ("client-report" | "ra-poll" | "session-end").
--
-- Idempotency itself is unchanged: the pre-existing
-- UserAchievement_userId_achievementId_key unique index already
-- guarantees one unlock row per (user, achievement). Every writer now
-- goes through unlocksRepo.recordUnlock(), which upserts against that
-- key, so two providers reporting the same unlock cannot double-credit.
-- `source` is recorded for diagnostics only and does NOT widen the key.

ALTER TABLE "UserAchievement"
    ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
