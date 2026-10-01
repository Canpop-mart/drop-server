export const taskGroups = {
  // ── Scheduled cleanup ──────────────────────────────────────────────
  "cleanup:auth-records": { concurrency: false },
  "cleanup:objects": { concurrency: false },
  "cleanup:compat-logs": { concurrency: false },
  "cleanup:cloud-saves": { concurrency: false },
  "cleanup:rooms": { concurrency: false },
  "check:update": { concurrency: false },

  // ── Import (system-triggered, concurrent) ──────────────────────────
  "import:game": { concurrency: true },
  "import:version": { concurrency: true },

  // ── Library maintenance ────────────────────────────────────────────
  "check:game-updates": { concurrency: false },
  "scan:library-integrity": { concurrency: false },
  "refresh:metadata": { concurrency: false },

  // ── Achievements ───────────────────────────────────────────────────
  "scan:goldberg-readiness": { concurrency: false },
  "refresh:achievement-defs": { concurrency: false },
  "backfill:achievement-text": { concurrency: false },
  "link:retroachievements": { concurrency: false },
  "recalculate:achievements": { concurrency: false },
  "regenerate:manifests": { concurrency: false },
  // Drains the queue of changed versions (library/manifest-queue.ts), one
  // version at a time. That module keeps it to a single worker; concurrency
  // is on only so a new worker can start while the task pool is still
  // removing the previous, finished one.
  "regenerate:manifest-version": { concurrency: true },
  "backfill:gbe-swap": { concurrency: false },

  // ── System ─────────────────────────────────────────────────────────
  "recalculate:playtime": { concurrency: false },
  "backup:export": { concurrency: false },
} as const;

export type TaskGroup = keyof typeof taskGroups;
