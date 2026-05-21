# Achievements — 2026 Audit

Snapshot of the achievement subsystem (Goldberg + RetroAchievements) and
the streamlining that landed alongside this doc. Read together with
`server/internal/achievements/` for the live code.

This audit built on top of the metadata-2026 and tasks-2026 refactors and
the in-flight `fix/gbe-swap-detection` branch — it did **not** undo the
GBE-swap gating, the `defineDropTask` lifecycle work, or the import
pipeline phases.

## TL;DR — what changed

- New `server/internal/achievements/` module: `types.ts` (provider
  interface), `repo.ts` (canonical write paths), `goldberg.ts` +
  `retroachievements.ts` (providers), `config-cache.ts`, `index.ts`
  (registry + scan orchestrator).
- One scan orchestrator. `scan.post.ts` is now `scan?provider=…` (single
  game) **or** a bulk scan. `scan-goldberg` / `scan-retroachievements`
  are thin back-compat wrappers over it.
- One unlock write path: `unlocksRepo.recordUnlock`. The three writers
  (`achievements-report`, `ra-poll`, `session-end`) all go through it;
  double-credit is structurally impossible.
- One definition write path: `achievementsRepo.upsertDefinitions`.
  `setupGoldberg`, both RA scan endpoints and the RA link task use it.
- `achievement-config.get.ts` now has a 10 s server-side cache for the
  user-independent payload.
- `pages/admin/achievements.vue` split into Goldberg / RetroAchievements
  / Bulk tabs.

## Decision: `goldberg.ts` stays at `server/internal/goldberg.ts`

The brief allowed moving `goldberg.ts` into `server/internal/achievements/`
_or_ leaving it if the import-pipeline coupling made a move risky. **It
was left in place.** Reasons:

- It's imported by 10 files, including `server/internal/library/import/
setupEmulators.ts`, which calls `setupGoldberg` as an import phase.
- The `fix/gbe-swap-detection` branch already has uncommitted changes to
  `goldberg.ts`, `gbe.ts` and `setupEmulators.ts` from five parallel
  refactors. Moving the file mid-refactor would maximise merge pain for
  no functional gain.
- The provider interface wraps it cleanly anyway:
  `server/internal/achievements/goldberg.ts` is a thin adapter whose
  `scanGame` calls the existing `setupGoldberg`. The streamline goal
  (one provider interface, one write path) is met without the move.

`retroachievements.ts` was _also_ left at `server/internal/
retroachievements.ts` for symmetry and because `RetroAchievementsClient`
is imported by several endpoints — the new
`server/internal/achievements/retroachievements.ts` is the provider
adapter, the old file remains the low-level API client.

## Audit checklist findings

### 1. Duplicate scan endpoints — FIXED

`scan`, `scan-goldberg`, `scan-retroachievements` all existed because
they grew independently: `scan` was per-game single-provider,
`scan-goldberg` bulk-scanned the library for `steam_settings/`, and
`scan-retroachievements` bulk-scanned + auto-linked by RA name search.

**Now:** `scan.post.ts` is the single orchestrator. Body is
`{ provider?: "goldberg" | "retroachievements" | "both", gameId? }`. With
`gameId` it scans one game; without, it bulk-scans the library. Both
per-provider routes are kept as thin wrappers that call
`scanGame(...)` from the achievements module so old clients don't break.

**Behaviour change:** the old `scan-retroachievements` auto-linked
unlinked games via RA name search. That slow, rate-limited search now
lives **only** in the `link:retroachievements` background task. The
back-compat `scan-retroachievements` endpoint refreshes definitions for
already-linked games only. Documented in that file's header.

### 2. Two (actually three) unlock-report paths — FIXED

There were **three** writers, not two: `achievements-report.post.ts`
(Goldberg client reports), `ra-poll.post.ts` (live RA poll), and
`session-end.post.ts` (RA sync at session end). `ra-poll` and
`session-end` both used `prisma.userAchievement.create()` — a raw create
that would _throw_ a P2002 unique violation if the other path had
already recorded the unlock.

**Now:** all three go through `unlocksRepo.recordUnlock(userId,
achievementId, source, occurredAt)`. It upserts against the **existing**
`@@unique([userId, achievementId])` constraint:

- First sighting → row created.
- Repeat (any source) → no-op; the original `unlockedAt`/`source` kept.
- Concurrent insert → P2002 is caught and treated as "already unlocked".

Double-credit is therefore structurally impossible. A `source` column
(`"client-report" | "ra-poll" | "session-end"`) was added to
`UserAchievement` for provenance/diagnostics — it does **not** widen the
unique key (widening it would have _allowed_ per-source duplicates,
which is the opposite of the goal).

### 3. `debug/[gameId].get.ts` ACL — VERIFIED CORRECT

`server/api/v1/user/achievements/debug/[gameId].get.ts` enforces
`aclManager.getUserACL(h3, ["store:read"])` and 403s without it. Every
per-user query (`userAchievement.findMany`, `playSession.findMany`,
`client.findMany`) is scoped to the authenticated `user.id`. It does
**not** leak other users' unlock state — no auth bypass, no IDOR. Left
as-is. (It's user-auth rather than admin-auth on purpose: it powers the
diagnostics panel on `pages/account/achievements.vue`.)

### 4. Achievement-config caching — FIXED

`achievement-config.get.ts` is polled every ~15 s by every client and
did 4 Prisma round-trips per poll. New
`server/internal/achievements/config-cache.ts` caches the
**user-independent** slice (definitions, external links, RA hashes) per
`gameId` with a **10 s TTL** (`ACHIEVEMENT_CONFIG_TTL_MS`, deliberately
< the 15 s poll interval). Concurrent misses coalesce onto one DB read.

The per-user `unlocked` overlay is **not** cached — it stays a fresh,
small, indexed `userAchievement.findMany` so a player's own unlocks show
immediately and one user's state can never leak into another's cached
entry. `achievementsRepo.upsertDefinitions` calls
`invalidateGameAchievementConfig` after a write so scans show up at once.

Known gap (acceptable): adding/removing an external link via the generic
`external-link.{post,delete}.ts` endpoints, or wiping definitions via
`achievements-reset`, doesn't explicitly invalidate the cache — those
are admin-rare and the 10 s TTL self-heals. Wiring invalidation into
those endpoints was out of scope (they're not achievement-specific).

### 5. `setupGoldberg` vs scan task overlap — ADDRESSED

Both write `Achievement` rows. They now share
`achievementsRepo.upsertDefinitions`, so the records are byte-identical
regardless of which path ran. On task-level dedup: every registry task
built by `defineDropTask` already gets a `dedupKey` of
`dropTask:<group>` and the group is `concurrency:false`, so two
`scan:goldberg-readiness` / `refresh:achievement-defs` runs can't
overlap. `setupGoldberg` itself is **not** a task — it's a direct
function call from the import pipeline — so "task dedup" doesn't apply
to it; the shared idempotent write path is what makes a concurrent
import + scan safe. No new dedup key was needed.

### 6. RetroAchievements credentials — VERIFIED SAFE

`external-accounts/retroachievements.put.ts` takes `username`, `apiKey`,
`password`. The password is sent to RA's `dorequest.php?r=login2`
**server-side**, the returned Connect token is stored, and the password
is **never** persisted — only `externalId` (username), `token` (Web API
key) and `connectToken` land in `UserExternalAccount`. The account UI
(`pages/account/achievements.vue`) clears `raPassword` after the call
and labels the field "never stored". No change needed.

### 7. Achievement icons — CONFIRMED raw CDN URLs

All achievement icon URLs are raw CDN URLs:

- Goldberg/Steam: `def.icon` / `def.icon_gray` straight from the Steam
  API schema (e.g. `https://.../apps/<id>/<hash>.jpg`).
- RetroAchievements: `https://media.retroachievements.org/Badge/<n>.png`,
  built in one place now (`raAchievementsToDefinitions`).

None are routed through `objectHandler` / the object store. The admin
list, `AchievementCard.vue` and `pages/account/achievements.vue` all
`<img :src="iconUrl">` directly with an `@error` trophy fallback.
Matches `CLAUDE.md`. No leaks found.

### 8. Reset endpoints — DOCUMENTED (kept separate, on purpose)

They do **different** things and should stay separate:

- `user/achievements/reset.delete.ts` — a **user** clears **their own**
  `UserAchievement` rows (optionally one game). Achievement definitions
  are untouched. Self-service, `store:read` ACL, always scoped to
  `user.id`.
- `admin/game/[id]/achievements-reset.post.ts` — an **admin** deletes
  **all** `Achievement` definitions for a game **and** every user's
  unlocks for it. A hard wipe before a re-scan, `game:update` ACL.

Different actor, different blast radius, different ACL. Merging them
would be a footgun (a user could trigger a definition wipe, or an admin
reset would need a mode flag). Left as two endpoints; difference
recorded here.

## New module layout

```
server/internal/achievements/
  types.ts             AchievementProvider interface + shared types
  repo.ts              achievementsRepo / unlocksRepo — canonical writes
  goldberg.ts          Goldberg provider (adapter over ../goldberg.ts)
  retroachievements.ts RetroAchievements provider + RA→def mapping
  config-cache.ts      10s cache for achievement-config polling
  index.ts             provider registry + scanGame() orchestrator
```

`AchievementProvider` = `{ name, scanGame, syncUnlocks, listDefinitions }`.
Goldberg's `syncUnlocks` is a deliberate no-op (its unlocks are pushed by
the client). RA implements all four.

## Logging

`console.log` was already absent from the achievement code; the audit
standardised the prefixes instead: `[ACH:goldberg]` and `[ACH:ra]` for
provider-specific lines, `[ACH]` for cross-provider (orchestrator,
recordUnlock, config cache). Scan timings are surfaced via
`ctx.markPhase()` in both providers (`goldberg:setup`,
`ra:fetch-definitions`, …).

## Acceptance criteria

- [x] All admin scan endpoints route through one `scanGame(providers)`
      orchestrator.
- [x] `unlocksRepo.recordUnlock` is the only call site writing
      `UserAchievement`; double-credit is impossible (idempotent upsert
      on the pre-existing `(userId, achievementId)` unique key).
- [x] `achievement-config.get.ts` has a documented cache, TTL 10 s.
- [x] `debug/[gameId]` ACL verified correct.
- [x] This doc.
- [x] `pnpm typecheck` — no new errors from these changes.

## Out of scope (untouched)

- No third achievement provider.
- Achievement Prisma schema changed only by the additive `source`
  column (no constraint widening — the idempotency key was already
  there).
- drop-app client-side achievement UI.

## Follow-ups (not done here)

- Migrate the admin UI off the back-compat `scan-goldberg` /
  `scan-retroachievements` routes onto `scan?provider=…`, then delete
  the wrappers. The new tabs already call the canonical endpoint;
  the wrappers exist only for any out-of-tree callers.
- Consider invalidating `config-cache` from `external-link.{post,delete}`
  and `achievements-reset` for instant consistency (currently TTL-healed).
- `UserAchievement.syncedAt` is now somewhat redundant with `source` +
  `unlockedAt`; could be dropped in a future schema pass.
