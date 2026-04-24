export const taskGroups = {
  // ── Scheduled cleanup ──────────────────────────────────────────────
  "cleanup:invitations": { concurrency: false },
  "cleanup:sessions": { concurrency: false },
  "cleanup:objects": { concurrency: false },
  "check:update": { concurrency: false },

  // ── Import (system-triggered, concurrent) ──────────────────────────
  "import:game": { concurrency: true },
  "import:version": { concurrency: true },

  // ── Library maintenance ────────────────────────────────────────────
  "check:game-updates": { concurrency: false },
  "scan:library-health": { concurrency: false },
  "cleanup:library-orphans": { concurrency: false },
  "refresh:metadata": { concurrency: false },

  // ── Achievements ───────────────────────────────────────────────────
  "scan:goldberg-readiness": { concurrency: false },
  "refresh:achievement-defs": { concurrency: false },
  "link:retroachievements": { concurrency: false },
  "recalculate:achievements": { concurrency: false },
  "upgrade:gbe": { concurrency: false },

  // ── System ─────────────────────────────────────────────────────────
  "recalculate:playtime": { concurrency: false },
  "backup:export": { concurrency: false },
} as const;

export type TaskGroup = keyof typeof taskGroups;
