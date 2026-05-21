-- Adds IpRule, backing the admin-controlled IP allowlist / blocklist.
--
-- Each row is an Allow or Deny rule matched against the client IP by the
-- `ip-filter` Nitro middleware. `pattern` holds an exact IPv4/IPv6 address
-- or a CIDR range; it is validated at the application layer before insert.
--
-- Enforcement is global (no per-route rules) and ordered: if any enabled
-- Allow rule exists the server runs default-deny, otherwise it denies only
-- IPs matching an enabled Deny. Localhost and health endpoints always
-- bypass the filter.

-- CreateEnum
CREATE TYPE "IpRuleKind" AS ENUM ('Allow', 'Deny');

-- CreateTable
CREATE TABLE "IpRule" (
    "id" TEXT NOT NULL,
    "kind" "IpRuleKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "IpRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpRule_enabled_idx" ON "IpRule" ("enabled");

-- CreateIndex
CREATE INDEX "IpRule_createdByUserId_idx" ON "IpRule" ("createdByUserId");

-- AddForeignKey
ALTER TABLE "IpRule"
    ADD CONSTRAINT "IpRule_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
