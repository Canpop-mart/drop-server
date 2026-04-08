export const taskGroups = {
  "cleanup:invitations": {
    concurrency: false,
  },
  "cleanup:objects": {
    concurrency: false,
  },
  "cleanup:sessions": {
    concurrency: false,
  },
  "check:update": {
    concurrency: false,
  },
  "import:game": {
    concurrency: true,
  },
  "import:version": {
    concurrency: true,
  },
  "import:check-integrity": {
    concurrency: false,
  },
  "check:game-updates": {
    concurrency: false,
  },
  "scan:achievements": {
    concurrency: false,
  },
  "download:gbe": {
    concurrency: false,
  },
  "upgrade:all-to-gbe": {
    concurrency: false,
  },
  "recalculate:playtime": {
    concurrency: false,
  },
} as const;

export type TaskGroup = keyof typeof taskGroups;
