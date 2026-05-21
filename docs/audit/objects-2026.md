# Object Store — 2026 Audit

Snapshot of `server/internal/objects/` and its consumers, plus the
streamline that landed alongside this doc. Read together with the
live code:

- `server/internal/objects/{backend,objectHandler,fsBackend,s3Backend,transactional,objectRefs,uploadLimits}.ts`
- `server/api/v1/object/[id]/{index.get,index.head,index.post,index.delete}.ts`
- `server/api/v1/client/object/[id]/index.get.ts`
- `server/internal/tasks/registry/objects.ts`
- `server/api/v1/admin/objects/{index.get,gc.post}.ts` (new)
- `pages/admin/objects/index.vue` (new)

## Findings

### 1. ACL model

`createFromSource(id, fn, metadata, permissions)` takes a list of
`"<scope>:<perm>"` strings. The handler walks the list, gates reads on
"first match wins", and maps to a `read | write | delete` priority.

Real usage:

| Caller                                      | ACLs                             | Intent                                         |
| ------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `auth/signup/simple`                        | `internal:read`, `<userId>:read` | Avatar — readable by any authenticated user.   |
| `auth/oidc`                                 | `internal:read`, `<userId>:read` | Same.                                          |
| `metadata` (game / company import)          | `internal:read`                  | Game art — readable by any authenticated user. |
| `screenshots` upload                        | `<userId>:read`                  | Private to that user.                          |
| `admin/news`, `admin/game/image/index.post` | `internal:read`                  | News / game image — authenticated users only.  |
| `admin/company/[id]/banner`, `…/icon`       | `internal:read`                  | Company art.                                   |
| `user/avatar`, `user/banner`                | `internal:read`                  | Profile chrome — anyone signed in.             |
| `bugreports/create`                         | `internal:read`                  | Bug-report screenshot — anyone signed in.      |

Verdict: every existing call site enforces what it intends.
`anonymous:read` is never used in practice — the entire object subsystem
gates on at least an authenticated session, which matches Drop's "store
is private to logged-in users" model. We don't need to change anything.

### 2. Cache headers + 304 / ETag

**Before:** `GET /api/v1/object/[id]` set `Cache-Control: private,
max-age=31536000, s-maxage=31536000, immutable` and an ETag built from
the legacy MD5 hash. `HEAD` had no cache headers. The client-protocol
variant set neither.

**After:** Every variant (public GET / HEAD / client GET) sets
`Cache-Control: private, max-age=31536000, immutable` and an `ETag`
that defaults to the object id itself (since ids are unique per
content). The legacy MD5 hash is still consulted on `If-None-Match`
so already-cached clients keep getting 304s during the rotation.

The 304 path now short-circuits _before_ opening the payload stream —
the previous code fetched the object even when it was about to respond
304, which negated half the point of caching.

### 3. Range requests

Not supported. Drop only serves images and small uploads today, and
images stream linearly. Flagging as a deferred follow-up should we
ever serve audio/video through the object store.

### 4. Streaming vs buffer

`objectHandler.fetchWithPermissions` already returns a `Readable` from
`fs.createReadStream`. No `readFileSync` exists in the GET path. We
removed a buffer hop in `FsObjectBackend.write` (was awaiting `end`
event instead of `pipeline()` `finish`, which could resolve before the
last bytes were flushed). The new `objectHandler.read()` exposes the
same streaming surface to internal callers (admin browser, future
backends) without forcing them to know about `fs`.

`FsObjectBackend.create()` now awaits its internal `this.write(…)` call.
Previously the call was fire-and-forget — `createFromSource` could
return while the payload was still being written, racing GET requests
for the same id against an empty file.

### 5. GC task safety

**Before:** The cleanup task scanned every Prisma model for fields
whose name ended in `objectid` / `objectids`. Implicit naming convention
— rename a column and GC silently deletes live in-use objects.

**After:** A single source of truth in
`server/internal/objects/objectRefs.ts` enumerates every reference
column. The GC task:

1. Calls `findUnregisteredObjectColumns()` at start. If any
   `*ObjectId` field on a live Prisma model isn't in the registry, GC
   logs a loud warning _and refuses to run_ until the registry is
   updated. Surfaced on the admin object browser as a drift banner.
2. Walks objects against the centralised registry. Each delete logs
   the reason ("orphaned (not referenced by any of N known columns)")
   so admins can audit what GC removed.
3. Checks `signal.aborted` between iterations — cancel button in the
   task UI works.
4. Emits `markPhase("scan")` / `"delete-orphans"` / `"cleanup-metadata"`
   so the TaskReceipt timeline shows where time was spent.

Reference columns currently tracked (count = 13):

| Model               | Field                   | Kind   |
| ------------------- | ----------------------- | ------ |
| game                | mIconObjectId           | scalar |
| game                | mBannerObjectId         | scalar |
| game                | mCoverObjectId          | scalar |
| game                | mLogoObjectId           | scalar |
| game                | mImageCarouselObjectIds | array  |
| game                | mImageLibraryObjectIds  | array  |
| company             | mLogoObjectId           | scalar |
| company             | mBannerObjectId         | scalar |
| user                | profilePictureObjectId  | scalar |
| user                | bannerObjectId          | scalar |
| screenshot          | objectId                | scalar |
| article             | imageObjectId           | scalar |
| bugReport           | screenshotObjectId      | scalar |
| applicationSettings | mLogoObjectId           | scalar |

### 6. Transactional creation

`transactional.ts.dump()` previously only cleared the in-memory
transaction map. Most call sites do `pull()` → on-disk write →
business logic → `dump()` on failure, so the on-disk objects leaked
until GC swept them.

Now `dump()` tracks which ids have been `pulled` and calls
`objectHandler.deleteAsSystem(id)` for each on cleanup. The signature
changed from `() => void` to `() => Promise<void>`; every call site
has been updated to await.

### 7. Backend abstraction

`server/internal/objects/backend.ts` defines a minimal interface
(`exists / read / write / delete / stat`). `FsObjectBackend` implements
both this and the legacy `ObjectBackend` abstract class that
`ObjectHandler` already consumed. A parallel `s3Backend.ts` stub
exists — implementing it is a single-file PR with no changes to
`objectHandler`, the HTTP endpoints, or the GC task. No `fs.*` calls
appear in `objectHandler.ts`'s public surface.

`ObjectHandler` now exposes `exists(id)`, `stat(id)`, `read(id)`,
`statAll(limit)` — backend-agnostic reads for the admin browser and
the GC task. They consult the new-shape methods when present and fall
back to the legacy methods otherwise.

### 8. Upload limits

Centralised in `server/internal/objects/uploadLimits.ts`:

| Key                  | Limit |
| -------------------- | ----- |
| profileAvatar        | 5 MB  |
| profileBanner        | 10 MB |
| gameImage            | 20 MB |
| companyImage         | 20 MB |
| newsImage            | 10 MB |
| bugReportScreenshot  | 10 MB |
| screenshot           | 50 MB |
| rawObject (fallback) | 50 MB |

Two enforcement points:

- `enforceUploadLimit(h3, key)` — Content-Length pre-check. Rejects
  oversized uploads with 413 before reading the body.
- `assertWithinLimit(bytes, key)` — post-buffer check. Survives a
  missing or lying Content-Length header.

Wired into `handleFileUpload` (multipart) and the raw object POST
endpoint. Screenshot uploads — which stream straight from
`h3.node.req` into the backend without buffering — also enforce a
_streaming_ cap inside `ScreenshotManager.upload`: bytes are counted
as they flow, and the upstream is destroyed mid-flight on the first
chunk that crosses the limit. A partial object is cleaned up on
abort so GC doesn't have to chase it.

### 9. POST endpoint validation

The raw POST endpoint previously accepted any binary payload of any
size. Now enforces `rawObject` (50MB) at both Content-Length and
post-buffer. Mime type validation still lives in the handler
(`fetchMimeType`); no behaviour change there.

### 10. Object naming

Today every object id is a `randomUUID()` — no deduplication. Two
users uploading the same image consume 2× disk.

Added `objectHandler.createContentAddressed(fetcher, metadata, acls)`
which hashes the buffer (SHA-256) and uses the digest as the id. If
the same content is uploaded a second time, the existing object's id
is returned and no new write happens. Behind a feature flag for now
(opt-in via the new helper rather than retrofitting callers) — the
plan is to migrate one path at a time after this PR lands. UUID and
content-hash objects coexist freely.

## New endpoints

| Method | Path                       | ACL                |
| ------ | -------------------------- | ------------------ |
| GET    | `/api/v1/admin/objects`    | `maintenance:read` |
| POST   | `/api/v1/admin/objects/gc` | `task:start`       |

## New files

- `server/internal/objects/backend.ts` — formal `ObjectStorageBackend`
  interface
- `server/internal/objects/objectRefs.ts` — single source of truth for
  GC reference columns + drift detection
- `server/internal/objects/s3Backend.ts` — stub
- `server/internal/objects/uploadLimits.ts` — per-asset-class size
  caps
- `server/api/v1/admin/objects/index.get.ts` — admin stats endpoint
- `server/api/v1/admin/objects/gc.post.ts` — manual GC trigger
- `pages/admin/objects/index.vue` — admin object browser

## Files changed (object-related)

- `server/internal/objects/{fsBackend,objectHandler,transactional}.ts`
- `server/internal/utils/handlefileupload.ts`
- `server/internal/screenshots/index.ts`
- `server/internal/tasks/registry/objects.ts`
- `server/internal/metadata/index.ts` (`dump` is now async)
- `server/api/v1/object/[id]/{index.get,index.head,index.post}.ts`
- `server/api/v1/client/object/[id]/index.get.ts`
- `server/api/v1/screenshots/game/[id]/index.post.ts`
- `server/api/v1/user/{avatar,banner}.post.ts`
- `server/api/v1/admin/{news/index.post,game/image/index.post,company/[id]/banner.post,company/[id]/icon.post,game/[id]/metadata.post}.ts`
- `server/api/v1/bugreports/create.post.ts`
- `layouts/admin.vue` — sidebar link to the new page

## Not done / deferred

- **Range requests.** Drop has no audio/video served via the object
  store today. Add `Accept-Ranges` support when that changes.
- **Content-hash mode rollout.** The helper is in place but no caller
  has been migrated. Suggested first target: game cover / banner
  imports, since metadata sources are frequently duplicated across
  Steam / IGDB / GiantBomb and we waste disk on byte-identical art.
- **S3 backend implementation.** Stub only. Wiring up
  `@aws-sdk/client-s3` is a single-file PR with no changes
  elsewhere.
- **Per-user upload quotas.** Limits today are per-request. Tracking
  cumulative bytes per user (screenshots especially) is a separate
  feature and out of scope.
- **Stricter mime allow-list.** Today the handler accepts anything
  `file-type-mime` can identify. Restricting to `image/*` for the
  image endpoints would block "I uploaded a PDF as my avatar" but
  needs care for endpoints that legitimately accept other types.
- **Streaming reads inside `objectHandler.fetchHash`.** The hash path
  still pipes through `.on('end')` which has the same subtle
  resolves-too-early issue we fixed in `write()`. Low-risk because
  the hash is content-addressed downstream, but worth converting to
  `pipeline()` next time someone is in there.
