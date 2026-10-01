-- Track when a member last used each Archipelago session through Drop (joined
-- or rejoined, opened or polled it, uploaded a YAML, set the connect address),
-- so the daily reaper never closes a Setup session people are still using.
--
-- Purely additive. Existing sessions start their idle clock at the time this
-- migration runs, so none of them can be reaped for at least 30 days after it.

-- AlterTable
ALTER TABLE "ArchipelagoSession" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
