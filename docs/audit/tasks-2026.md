# Background Tasks — 2026 Audit

Snapshot of `server/internal/tasks/` and consumers, with the findings
that motivated the refactor that landed alongside this doc. Read
together with `server/internal/tasks/index.ts` for the live code.

## Findings

### 1. `defineDropTask` vs `taskHandler.create` divergence

Every file under `server/internal/tasks/registry/` already used
`defineDropTask`. The remaining direct callers of `taskHandler.create`
were three ad-hoc paths that need to capture closures over runtime
data (uploaded metadata, version manifests) and so can't be expressed
as a static registry entry:

- `server/internal/library/index.ts` — `importVersion`
- `server/internal/metadata/index.ts` — `createGame`
- `server/api/v1/admin/import/massversion/index.post.ts`
- `server/api/v1/admin/game/[id]/versions/refresh.post.ts`

Decision: `defineDropTask` is the canonical entrypoint for any task
that has no per-run closure state. `taskHandler.create` is a
back-compat shim kept available for the four call sites above. We
mark ad-hoc tasks with `retryArgs.kind = "ad-hoc"` in the receipt so
the admin UI can hide the retry button — re-running an import needs
the original upload, not just the metadata.

### 2. Retry policy

**Before:** A throw inside `run()` set `task.error`, persisted to
`prisma.task`, and the task vanished. There was no retry path at all
— admins had to click the original action again.

**After:** Every run ends with a `TaskReceipt` row carrying
`status` ∈ `success | failed | cancelled | orphaned` plus the
arguments needed to retry. Registered tasks expose a `Retry` button
in the admin UI; one click hits `POST /api/v1/admin/task/[id]/retry`
which goes through `runTaskGroupByName` (same code path the manual
"Execute" button uses).

### 3. Concurrency / deduplication

**Before:** `taskGroups[group].concurrency` already enforced single-flight
per group; `taskHandler.hasTaskKey` was opt-in for callers that wanted
finer-grain deduplication.

**After:** Single-flight by default. `defineDropTask` now sets
`task.key = "dropTask:<group>"` automatically, so `create()` refuses to
start a second copy of the same task even within the brief window
between `runTaskGroupByName` calls. Custom dedup keys are still
available via `dedupKey: () => string` (used by the importers to
key on `gameId + libraryPath`).

### 4. Scheduling

**Before:** Two paths.
1. The legacy `dailyScheduledTasks` / `weeklyScheduledTasks` arrays
   inside `TaskHandler`, fired by `server/tasks/dailyTasks.ts` (Nitro
   scheduled task) and replayed at boot by `server/plugins/tasks.ts`.
2. Nothing else. `check:game-updates` was advertised as periodic but
   only ran when an admin clicked the button.

**After:** A declarative `schedule?: DropTaskSchedule` field on each
`BuildTask`. Two flavours:
- `{ intervalMs: number }` — registered by `tasks/scheduler.ts` at boot
  using `setInterval`. Single-flight + concurrency:false still prevent
  overlap if the previous run hasn't finished.
- `{ daily }` / `{ weekly }` — routed through the existing legacy
  bucket so behaviour for the four tasks already there is identical.

`check:game-updates` now has `schedule: { intervalMs: 6h }`. Add
schedules to other tasks by adding the field; the scheduler walks the
registry at startup.

### 5. Progress reporting

Every registry task already calls `progress()`. The audit caught two
silent cases (`check:game-updates` and `upgrade:gbe` only emitted
progress between games, so a network stall would freeze the UI). Both
now also check `signal.aborted` between iterations, which has the side
effect of yielding to the event loop.

New `markPhase("name")` API: cheap accounting hook that records
named phase timings in `TaskReceipt.progressLog.phases`. Doesn't
affect progress %. Applied to `upgrade-to-gbe` as a worked example.
The `setup` / `run` / `teardown` lifecycle hooks (if a task declares
them) also auto-emit phase markers.

### 6. `addAction` usage

`task.actions` is rendered by `TaskWidget.vue`, the standalone task
page, and the admin task index. Confirmed working — actions are
serialised as `Label:URL` strings, the UI splits on `:` and renders
clickable links. Now also propagated into `TaskReceipt.actions` so
the history tab shows them.

### 7. `wrapTaskContext` semantics

The min/max/prefix math is correct — verified against the existing
mass-import call sites (`min: i/n*100`, `max: (i+1)/n*100`). After the
refactor, `wrapTaskContext` also forwards `markPhase` and `signal`
straight through, so nested tasks inherit cancellation and contribute
to the parent's phase log instead of opening their own.

### 8. Crash recovery

**Before:** A server crash mid-task left the `prisma.task` row never
written. Nothing told the operator the task had been in flight.

**After:** Receipts are written at the START of a task with
`status="in_progress"` and sealed at the end via `upsert`. The
plugin-level `taskHandler.sweepOrphanedReceipts()` runs on every boot
and flips any leftover `in_progress` rows (no endedAt) to `orphaned`.
The admin UI surfaces an orange triangle icon for orphans so they're
visibly distinct from genuine failures.

The legacy `prisma.task` row is still only written at the end; the
sweep does not touch it, since old admin queries assume `Task.ended`
is non-null.

### 9. ACLs on admin task endpoints

Three new ACLs (`task:cancel`, `task:retry`, `task:delete`) gate the
new endpoints. Admins get them by default via the admin-all-acls
branch in `aclManager.allowSystemACL`. Existing `task:read` covers the
new `/api/v1/admin/task/receipts` listing.

### 10. Logging consistency

Pre-refactor mix of `console.log` and `logger.info` was minimal in
this subtree (mostly the task pool internals). Standardised on the
shared `logger` with `[TASK:<group>]` prefixes for end-of-task
warnings and `[scheduler]` / `[sweep]` for system-level events.
Per-task pino instances still use the structured `prefix` field via
`logger.child({ prefix })`.

## Schema changes

`prisma/models/task.prisma` — added `TaskReceipt` (see migration
`20260518010000_add_task_receipt`). The legacy `Task` table is kept
around for now and written to in parallel; phasing it out is a
follow-up once admin clients on stale builds have rotated.

## New endpoints

| Method | Path                                       | ACL              |
| ------ | ------------------------------------------ | ---------------- |
| GET    | `/api/v1/admin/task/receipts`              | `task:read`      |
| POST   | `/api/v1/admin/task/[id]/cancel`           | `task:cancel`    |
| POST   | `/api/v1/admin/task/[id]/retry`            | `task:retry`     |
| DELETE | `/api/v1/admin/task/[id]`                  | `task:delete`    |

## Files changed

- `prisma/models/task.prisma` + new migration
- `server/internal/tasks/index.ts` — lifecycle hooks, dedup, signal,
  markPhase, sweep, cancel
- `server/internal/tasks/scheduler.ts` — new declarative scheduler
- `server/plugins/tasks.ts` — sweep + scheduler bootstrap
- `server/internal/acls/{index,descriptions}.ts` — 3 new ACLs
- `server/api/v1/admin/task/[id]/{cancel,retry,index.delete}.ts`
- `server/api/v1/admin/task/receipts.get.ts`
- `server/api/v1/admin/task/index.get.ts` — surface taskGroup
- `server/api/v1/admin/import/massversion/index.post.ts` — forward
  `markPhase` / `signal`
- `server/api/v1/admin/game/[id]/versions/refresh.post.ts` — same
- `server/internal/tasks/registry/{game-update,upgrade-to-gbe}.ts` —
  exemplar adopters of `schedule` and `signal`
- `pages/admin/task/index.vue` — tabs, history filter, retry/cancel
- `components/TaskWidget.vue` — exposes an `actions` slot

## Not done / deferred

- Migrating all registry tasks to lifecycle hooks (setup/teardown/onError).
  Only `upgrade-to-gbe` was touched as an exemplar; the others remain on
  the simple `run()` path. They will get hooks when there's a reason to.
- Writing TaskReceipt at task **start** instead of completion. See
  finding 8 — held off to preserve the contract that the legacy
  `Task.ended` is always non-null. Orphan sweep covers the crash case
  for now via the in_progress→orphaned transition.
- i18n: new UI strings (filter labels, status names, "Retry"/"Cancel"
  buttons) are hardcoded English. Existing i18n keys still cover the
  scheduled-task name/description block. Translation work is its own
  PR.
