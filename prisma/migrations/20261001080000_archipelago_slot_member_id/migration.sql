-- Record each Archipelago slot's ZeroTier node id so the server can
-- de-authorize a device from the shared overlay when it leaves a session or
-- the session closes.
--
-- Purely additive and nullable: existing slots get NULL and are backfilled the
-- next time that device joins or reconnects to its session.

-- AlterTable
ALTER TABLE "ArchipelagoSlot" ADD COLUMN "memberId" TEXT;
