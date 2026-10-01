-- The client registration (Client.id) that tombstoned a cloud save.
--
-- Devices used to recognise their own deletes by comparing `deletedFrom`, a
-- display name, against their own. Renaming a device, or two devices sharing
-- a hostname, broke that both ways. The client id is what the server already
-- authenticates every client request with, so it cannot drift.
--
-- Purely additive and nullable: rows tombstoned before this have no id, and
-- clients fall back to the name for those.

-- AlterTable
ALTER TABLE "CloudSave" ADD COLUMN "deletedFromClientId" TEXT;
