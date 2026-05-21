# Metadata Provider Stack — 2026 Audit

Snapshot of `server/internal/metadata/` and its consumers, plus the
streamline that landed alongside this doc. Read together with the live
code:

- `server/internal/metadata/{index,types.d,http,cache}.ts`
- `server/internal/metadata/{steam,igdb,pcgamingwiki,giantbomb,steamgriddb,manual}.ts`
- `server/plugins/03.metadata-init.ts`
- `server/api/v1/admin/metadata/{backfill-logos.post,health.get,test-fetch.post}.ts`
- `server/api/v1/admin/import/game/search.get.ts`
- `pages/admin/metadata/index.vue`

`http.ts`, `cache.ts`, `health.get.ts`, `test-fetch.post.ts` and the
rewritten `index.vue` are new.

## Findings

### 1. Provider interface consistency

All five real providers (`steam`, `igdb`, `pcgamingwiki`, `giantbomb`,
`manual`) already `implements MetadataProvider` and exposed the same four
methods (`name`, `source`, `search`, `fetchGame`, `fetchCompany`). The
interface lived as an `abstract class` in `index.ts`.

**Change:** the canonical contract now lives in `types.d.ts` as
`IMetadataProvider`. `index.ts` re-exports `MetadataProvider` as a type
alias (back-compat — every provider's `import type { MetadataProvider }`
keeps working) and keeps an `AbstractMetadataProvider` class for anyone
who wants the base. Added an **optional** `health()` method to the
interface — providers with a cheap auth-check ping (IGDB, GiantBomb)
implement it; Steam / PCGamingWiki fall back to stats-inferred health.

### 2. Auth + secrets

| Provider     | Secret(s)                            | Env var(s)                            |
| ------------ | ------------------------------------ | ------------------------------------- |
| Steam        | none — undocumented public endpoints | —                                     |
| IGDB         | Twitch OAuth client credentials      | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`|
| GiantBomb    | API key                              | `GIANT_BOMB_API_KEY`                  |
| SteamGridDB  | API key                              | `STEAMGRIDDB_API_KEY`                 |
| PCGamingWiki | none — anonymous MediaWiki           | —                                     |

Each provider constructor throws `MissingMetadataProviderConfig` when its
env vars are absent; `03.metadata-init.ts` catches that and skips the
provider. So a missing key self-disables a provider rather than crashing
boot.

**IGDB token refresh — verified correct.** The Twitch token is cached on
the singleton instance with `accessTokenExpiry`. `refreshCredentials()`
only re-auths when the token is within 1 day of expiry; Twitch tokens
last ~60 days. It is **not** re-fetched per request. A failed auth now
flips the provider to `unauthenticated` on the health page instead of
failing silently on every later call.

**PCGamingWiki — verified stateless.** All requests are plain
unauthenticated GETs against `api.php`. No cookies, no session, no login.
Each request stands alone.

### 3. Rate limiting — standardised

**Before:** every provider hand-rolled it. IGDB had a 3-attempt
exponential backoff for 429; Steam / PCGamingWiki / GiantBomb each set
`retry: 1, retryDelay: 1_000` inline; SteamGridDB had a bespoke
`AbortController` timeout and no retry.

**After:** new `metadata/http.ts` — `metadataHttp.fetch(provider, url,
opts)`. Per-provider token bucket (lazy refill, no `setInterval`),
exponential backoff (1s/2s/4s) on 429/503/504/5xx/network errors,
non-transient 4xx rethrown immediately, 20s timeout, `User-Agent:
Drop/<version>` on every request. Buckets: Steam 30/10s, IGDB 4/s (their
published limit), PCGamingWiki 10/10s, GiantBomb 60/min, SGDB 30/min.
Every provider file swapped its raw `$fetch` for the shared client.

### 4. Caching — added

New `metadata/cache.ts` — in-memory LRU with per-call-type TTL:

- **search** — 1 hour. Re-typing the same query in the admin import box
  is now free.
- **company** — 30 days. Hits are still served from Postgres
  (`Company.metadataOriginalQuery`); the cache covers the in-flight path.
- **company-miss** — 1 day. **The real win.** Importing a multi-studio
  game used to re-ask all providers about a genuinely-unknown indie
  publisher once per related game. `fetchCompany` now caches the miss.

`fetchGame` results are deliberately **not** cached — they carry
`ObjectReference` IDs that are only valid inside the calling transaction;
caching them would hand stale object IDs to a later import. The
`game-update` task already does not re-fetch from providers (see
`registry/refresh-metadata.ts`), so the wasteful-re-fetch concern from the
checklist was partly a non-issue; the search + company caches close the
rest.

### 5. Fallback chain — added

`createGame` previously used exactly the provider the admin picked in the
search UI; if its `fetchGame` threw, the whole import failed. Now it
builds a chain (selected provider first, then every other non-Manual
provider) and walks it until one succeeds. Each failure logs
`[fallback] <provider> failed: <reason> — trying next provider`, and a
successful fallback logs which provider saved the import. The
transactional object handler is re-issued between attempts so a failed
provider's half-registered image refs don't leak into the next.

Default order is the registry's priority order, configured via the
existing `metadataProviders` application setting (persisted by
`03.metadata-init.ts`) — that already exists and already drives the
ordering, so no new `metadata.providerOrder` setting was added; the
existing one is the single source of truth.

### 6. Company resolution

`fetchCompany` iterates all providers. Failed lookups are now cached for
1 day (see §4) so the chain doesn't re-walk for the same missing company.

### 7. Image fetching

Cover/screenshot dedup is handled at the object layer:
`objectHandler.createContentAddressed` (from the object-storage refactor)
hashes bytes so identical images collapse to one object. The metadata
providers register image **URLs** into the transactional handler, which
pulls them lazily — two providers returning the same cover URL is rare
because the fallback chain stops at the first success (only one
provider's images are ever pulled per import). Switching the
transactional pull path to content-addressing is a worthwhile follow-up
but is object-layer work, out of scope for this metadata-only pass.

### 8. Error surfacing

`createGame` failures now throw an aggregated error listing every
provider that failed and why. Per-provider failures log at `warn` with
the provider name prefixed. The admin metadata page (§ below) surfaces
live failure counts + last-error strings.

### 9. PCGamingWiki parser fragility

`getPageContent` scrapes a MediaWiki-rendered DOM. Added explicit `warn`
logs when the `.introduction` or `.template-infobox` selectors match
nothing — when PCGamingWiki reskins, an admin sees exactly which selector
broke in the import task log instead of a silently-empty description.

### 10. GiantBomb — NOT dead, re-wired

`giantbomb.ts` was fully implemented but commented out in
`03.metadata-init.ts` ("GiantBomb changed their API"). The code uses
standard documented endpoints; the likely original breakage was the
missing `User-Agent` (GiantBomb blocks UA-less requests) — which the
shared HTTP client now always sets. GiantBomb is **re-enabled** in the
init plugin; it self-disables when `GIANT_BOMB_API_KEY` is unset, so this
is safe for instances that never configured it.

## New admin surface

`GET /api/v1/admin/metadata/health` → per-provider status (`up | down |
unauthenticated | rate-limited`) + request/failure/rate-limit counts +
last error, plus cache hit-rate. `POST /api/v1/admin/metadata/test-fetch`
→ runs a cross-provider search without importing. Both `maintenance:read`.

`pages/admin/metadata/index.vue` rewritten: cache stat tiles, a
per-provider health table, and a test-fetch form. The old tags/companies
links are kept as buttons. **Web-only** — admin tooling, embeds fine in
the desktop client's admin iframe, no native client work needed.

## Follow-ups

- Switch the transactional object pull path to `createContentAddressed`
  so cross-provider image dedup is automatic (object-layer change).
- Optional Postgres-backed cache layer for cold restarts — `cache.ts`
  has a deliberately narrow `get`/`set`/`invalidate` surface so it can be
  wrapped without touching call sites.
- `metadataHttp` stats are process-local; a clustered deployment would
  want them aggregated.
