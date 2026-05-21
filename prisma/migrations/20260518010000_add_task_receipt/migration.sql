-- Adds TaskReceipt, the queryable history record for every task run.
-- Coexists with the legacy `Task` table; new runs write to both for now
-- so old admin queries keep working until the migration is complete.

CREATE TABLE "TaskReceipt" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT,
    "taskGroup" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acls" TEXT[],
    "actions" TEXT[],

    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    -- success | failed | cancelled | orphaned
    "status" TEXT NOT NULL,

    "error" TEXT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retryArgs" JSONB,
    "progressLog" JSONB,

    CONSTRAINT "TaskReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskReceipt_status_startedAt_idx"
    ON "TaskReceipt" ("status", "startedAt");

CREATE INDEX "TaskReceipt_taskGroup_startedAt_idx"
    ON "TaskReceipt" ("taskGroup", "startedAt");
