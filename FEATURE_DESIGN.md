# Drop — Feature Design Document

## A. Achievements

### Overview

Drop provides cross-platform achievement tracking for DRM-free games using Steam emulators (Goldberg/GBE and SmartSteamEmu). The system is **Drop-controlled**: the server is the single source of truth for achievement definitions and AppIDs. The client fetches this configuration before every game launch and writes all emulator config files to disk, overwriting whatever was there before. No scanning or detection of pre-existing files is needed.

### Design Principles

1. **Server is source of truth** — Achievement definitions and AppIDs live in the database. The client never relies on files that happen to exist on disk.
2. **Generate + overwrite on every launch** — All Goldberg config files (`achievements.json`, `steam_appid.txt`) are written from server data before the game starts. This ensures consistency even if files are corrupted, deleted, or out of date.
3. **Admin import creates the data** — When an admin imports a game, `setupGoldberg()` fetches definitions from the Steam Web API and stores them in the DB. This is the only time external data enters the system.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Server (Nuxt 3)                                             │
│                                                              │
│  ┌──────────────────┐   ┌─────────────────────────────────┐  │
│  │ Achievement DB    │   │ API Endpoints                   │  │
│  │ - Achievement     │◄──│ GET  .../achievement-config     │  │
│  │ - UserAchievement │◄──│ POST .../achievements-report    │  │
│  │ - GameExternalLink│   │ POST .../session-end (no-op)    │  │
│  └──────────────────┘   └─────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Admin: setupGoldberg() runs BEFORE manifest generation   ││
│  │  - Fetches achievement defs from Steam Web API           ││
│  │  - Writes steam_settings/achievements.json               ││
│  │  - Writes steam_settings/steam_appid.txt                 ││
│  │  - Writes drop-goldberg/<AppID>/achievements.json        ││
│  │  - Creates GameExternalLink + Achievement records in DB  ││
│  │  All files are included in the manifest → downloaded     ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Client (Tauri)                                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Pre-launch                                             │  │
│  │  1. configure_saves_for_game(install_dir)              │  │
│  │     → Detects emulator type, writes configs.user.ini   │  │
│  │     → Returns EmulatorInfo { dll_dir }                 │  │
│  │  2. Cloud save sync check (only pre-launch API call)   │  │
│  │     → GET /api/v1/client/saves/:id/sync-status         │  │
│  │                                                        │  │
│  │  All other config files (achievements.json,            │  │
│  │  steam_appid.txt, drop-goldberg/) come from the        │  │
│  │  download — written by server during import.           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ During gameplay: poll_achievements() loop (every 15s)  │  │
│  │  1. Read local emulator files (disk I/O, no network)   │  │
│  │  2. Diff against known unlocked set                    │  │
│  │  3. Report new unlocks → POST achievements-report      │  │
│  │  4. Refresh state from server                          │  │
│  │  5. Emit "achievement_unlocked" to Vue frontend        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Post-exit                                              │  │
│  │  Final one-shot local check → report remaining unlocks │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Database Models

**Achievement** — One per unique achievement per game (keyed by `gameId + provider + externalId`).

| Field         | Type      | Description                                                   |
| ------------- | --------- | ------------------------------------------------------------- |
| id            | UUID      | Primary key                                                   |
| gameId        | FK → Game | Which game this belongs to                                    |
| externalId    | String    | API name, e.g. `ACH_WIN_GAME`                                 |
| provider      | Enum      | `Steam`, `RetroAchievements`, `Goldberg`                      |
| title         | String    | Display name                                                  |
| description   | String    | How to earn it                                                |
| iconUrl       | String    | Unlocked icon (raw CDN URL, not proxied through object store) |
| iconLockedUrl | String    | Locked icon                                                   |
| displayOrder  | Int       | Sort position                                                 |

**UserAchievement** — Join table for user unlocks (keyed by `userId + achievementId`).

| Field         | Type             | Description                 |
| ------------- | ---------------- | --------------------------- |
| userId        | FK → User        | Who earned it               |
| achievementId | FK → Achievement | Which achievement           |
| unlockedAt    | DateTime         | When the player earned it   |
| syncedAt      | DateTime         | When the server recorded it |

**GameExternalLink** — Maps Drop game IDs to platform-specific IDs (keyed by `gameId + provider`).

| Field          | Type      | Description                  |
| -------------- | --------- | ---------------------------- |
| gameId         | FK → Game | Drop's internal game ID      |
| provider       | Enum      | `Goldberg`, `Steam`, etc.    |
| externalGameId | String    | Steam AppID (e.g. `1794680`) |

### File Locations

#### Server (NAS library storage)

```
<library_baseDir>/<libraryPath>/<versionPath>/
  <dllSubdir>/               ← may be nested (e.g. GameData/Plugins/x86_64/)
    steam_api64.dll          ← or steam_api.dll / libsteam_api.so
    steam_settings/
      steam_appid.txt        ← "1794680"
      achievements.json      ← definitions array from Steam API or manual
      configs.user.ini       ← written by client pre-launch
```

The server writes `steam_appid.txt` and `achievements.json` during game import via `setupGoldberg()`. If the definitions file is missing locally, the server fetches from the Steam Web API (requires `STEAM_API_KEY` env var). These files on the NAS are the import-time snapshot; the client does NOT read from the NAS.

#### Client (player's machine) — Drop-controlled

All emulator config files are written by the server during game import (before manifest generation) and included in the download. The client only writes `configs.user.ini` at launch time.

**Included in download (written by server at import):**

```
<dll_dir>/
  steam_settings/
    steam_appid.txt          ← AppID
    achievements.json        ← definitions from Steam Web API
  drop-goldberg/<AppID>/
    achievements.json        ← definitions (runtime copy for Goldberg)
```

**Written by client at launch (user-specific):**

```
<dll_dir>/steam_settings/configs.user.ini   ← local_save_path + account_name
```

**Updated by Goldberg during gameplay:**

```
<dll_dir>/drop-goldberg/<AppID>/achievements.json   ← earned/earned_time fields added
```

**AppData fallback locations (checked in order if primary doesn't exist):**

```
%APPDATA%/drop-goldberg/<AppID>/achievements.json        ← legacy Drop
%APPDATA%/GSE Saves/<AppID>/achievements.json            ← GBE fork default
%APPDATA%/GSE saves/<AppID>/achievements.json            ← case variant
%APPDATA%/Goldberg SteamEmu Saves/<AppID>/achievements.json  ← original Goldberg
```

**SmartSteamEmu:**

```
C:\Users\Public\Documents\Steam\RUNE\<AppID>\achievements.ini
```

### Achievement JSON Formats

The client parser supports two formats (Goldberg/GBE write both):

**Array format:**

```json
[
  { "earned": true, "earned_time": 1704067200, "name": "ACH_WIN_GAME" },
  { "earned": false, "earned_time": 0, "name": "ACH_COLLECT_ALL" }
]
```

**Map format (GBE fork):**

```json
{
  "ACH_COLLECT_ALL": { "earned": false, "earned_time": 0 },
  "ACH_WIN_GAME": { "earned": true, "earned_time": 1704067200 }
}
```

**SSE format (`achievements.ini`):**

```ini
[SteamAchievements]
Count=2
0=ACH_WIN_GAME
0_UnlockTime=1704067200
1=ACH_COLLECT_ALL
1_UnlockTime=1704067201
```

### Emulator Detection

The client detects the emulator type by examining the DLL directory:

1. `steam_settings/` directory exists → **Goldberg/GBE**
2. `steam_emu.ini` file exists → **SmartSteamEmu**
3. Neither → defaults to **Goldberg** (best guess)

DLL search is breadth-first up to 5 directory levels deep, looking for `steam_api64.dll`, `steam_api.dll`, or `libsteam_api.so`.

### Provider Deduplication

A game can have the same achievement from multiple sources (Goldberg, Steam, RetroAchievements). Deduplication happens at the `externalId` level. An achievement is considered unlocked if ANY provider variant is unlocked. This prevents duplicate notifications when migrating between providers.

### Error Handling & Resilience

- Goldberg file reads retry up to 3 times with backoff (200ms, 400ms, 600ms) to handle game-process file locks.
- Timestamps are validated (must be between 2000-01-01 and 2100-01-01); invalid timestamps use current UTC time.
- `setupGoldberg()` failures are logged but never block game imports.
- Achievement polling failures are logged and retried on the next 15-second cycle.

### API Endpoints

| Method | Path                                           | Auth       | Purpose                                    |
| ------ | ---------------------------------------------- | ---------- | ------------------------------------------ |
| GET    | `/api/v1/client/game/{id}/achievement-config`  | Client JWT | Fetch definitions + unlock status + AppIDs |
| POST   | `/api/v1/client/game/{id}/achievements-report` | Client JWT | Report new unlocks from local files        |
| POST   | `/api/v1/client/game/{id}/session-end`         | Client JWT | Session end notification (currently no-op) |
| GET    | `/api/v1/games/{id}/achievements`              | User       | Public game page with rarity percentages   |
| GET    | `/api/v1/user/achievements/list`               | User       | User's unlocked achievements               |
| DELETE | `/api/v1/user/achievements/reset`              | User       | Reset achievements (optional `?gameId=`)   |
| GET    | `/api/v1/user/achievements/debug/{gameId}`     | User       | Diagnostic info for troubleshooting        |
| POST   | `/api/v1/admin/achievements/scan`              | Admin      | Scan single game for Goldberg definitions  |
| POST   | `/api/v1/admin/achievements/scan-goldberg`     | Admin      | Bulk-scan all library games                |
| POST   | `/api/v1/admin/game/{id}/achievements-reset`   | Admin      | Admin reset all achievements for a game    |

### Constants

| Name                       | Value             | Description                       |
| -------------------------- | ----------------- | --------------------------------- |
| `DROP_GSE_FOLDER`          | `"drop-goldberg"` | Goldberg save directory name      |
| Polling interval           | 15 seconds        | How often local files are checked |
| `FILE_READ_RETRIES`        | 3                 | Max retries for locked files      |
| `FILE_READ_RETRY_DELAY_MS` | 200               | Base retry delay (exponential)    |
| `MIN_TIMESTAMP`            | 946684800         | 2000-01-01 (validation floor)     |
| `MAX_TIMESTAMP`            | 4102444800        | 2100-01-01 (validation ceiling)   |

### Source Files

**Server:**

- Goldberg utilities: `server/internal/goldberg.ts` (setupGoldberg, fetchSteamAchievements, readGoldbergDefinitions)
- GBE DLL finder: `server/internal/gbe.ts`
- Achievement config endpoint: `server/api/v1/client/game/[id]/achievement-config.get.ts`
- Achievement report: `server/api/v1/client/game/[id]/achievements-report.post.ts`
- Admin scan: `server/api/v1/admin/achievements/scan.post.ts`, `scan-goldberg.post.ts`
- Admin UI: `pages/admin/achievements.vue`
- Schema: `prisma/models/achievement.prisma`

**Client (Rust):**

- Emulator detection + config: `src-tauri/remote/src/goldberg.rs` (configure_saves_for_game)
- Achievement polling: `src-tauri/remote/src/achievements.rs`
- Pre-launch integration: `src-tauri/process/src/process_manager.rs` (configs.user.ini + cloud save check)

---

## B. Cloud Saves

### Overview

Cloud saves allow players to back up and restore game save data across devices. Save data is archived into compressed tar.zst bundles, uploaded to the server's object storage, and can be downloaded and extracted on any device. The system supports both automatic sync (on game launch/exit) and manual upload/download.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Server (Nuxt 3)                                             │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ SaveSlot DB   │  │ Object Store │  │ API Endpoints      │ │
│  │ - per user    │  │ - tar.zst    │  │ /client/saves/...  │ │
│  │ - per game    │  │ - SHA256     │  │ /user/saves/...    │ │
│  │ - versioned   │  │   checksums  │  │ /admin/.../save-   │ │
│  │   history     │  │              │  │   paths            │ │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │
│                                                              │
│  Game.savePaths (String?, JSON-encoded)                      │
│  → Tells the client WHERE on disk to find save files         │
│  → Optional: Goldberg games auto-detect from emulator info   │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Client (Tauri)                                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Pre-launch (5s timeout)                                │  │
│  │  1. GET /sync-status → savePaths + slot checksums      │  │
│  │  2. If no savePaths → fall back to Goldberg dir        │  │
│  │  3. If cloud save exists → emit cloud_save_available   │  │
│  │  4. Cache paths + slot index on RunningProcess         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Post-exit (30s timeout)                                │  │
│  │  1. If cloud_save_paths cached → auto-upload           │  │
│  │  2. resolver::resolve() → tar.zst archive              │  │
│  │  3. POST .../push → upload to object store             │  │
│  │  4. Emit cloud_save_uploaded or cloud_save_upload_failed│ │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Manual (Tauri commands, triggered from UI)             │  │
│  │  upload_cloud_save(game_id, slot_index)                │  │
│  │  download_cloud_save(game_id, slot_index)              │  │
│  │  check_cloud_save_status(game_id)                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Database Models

**SaveSlot** — One per user per game per slot index (composite key: `gameId + userId + index`).

| Field            | Type        | Description                                         |
| ---------------- | ----------- | --------------------------------------------------- |
| gameId           | FK → Game   | Which game                                          |
| userId           | FK → User   | Which player                                        |
| index            | Int         | Slot number (auto-assigned)                         |
| name             | String      | Player-chosen label (default `""`)                  |
| createdAt        | DateTime    | When the slot was created                           |
| playtime         | Float       | Hours played at time of save                        |
| lastUsedClientId | FK → Client | Which device last uploaded (for conflict detection) |
| historyObjectIds | String[]    | Ordered list of object storage IDs (newest last)    |
| historyChecksums | String[]    | Ordered SHA256 hashes matching historyObjectIds     |
| lastSyncedAt     | DateTime?   | Last successful sync timestamp                      |

**Game.savePaths** — `String?` on the Game model. Stores a JSON-encoded save path configuration. Admins configure this via the admin panel, but for Goldberg games the client auto-detects from the emulator directory as a fallback.

### Save Path Configuration

The `savePaths` JSON tells the client where on disk to find save files:

```json
{
  "files": [
    {
      "conditions": [{ "type": "os", "value": "windows" }],
      "dataType": "file",
      "path": "<winAppData>/MyGame/saves",
      "tags": ["save"]
    },
    {
      "conditions": [{ "type": "os", "value": "linux" }],
      "dataType": "file",
      "path": "<xdgData>/MyGame/saves",
      "tags": ["save"]
    }
  ]
}
```

**Fallback chain when no savePaths configured:**

1. Check server for `Game.savePaths` → if set, use it
2. Detect emulator → use `<dll_dir>/drop-goldberg/` for Goldberg games
3. If neither → manual upload/download only (no auto-sync)

### Path Placeholders

The resolver translates placeholders to real paths at archive time:

| Placeholder            | Windows            | Linux              | macOS              |
| ---------------------- | ------------------ | ------------------ | ------------------ |
| `<home>`               | `C:\Users\<name>`  | `~`                | `~`                |
| `<root>`               | Games install root | Games install root | Games install root |
| `<game>`               | Game folder name   | Game folder name   | Game folder name   |
| `<base>`               | `<root>/<game>`    | `<root>/<game>`    | `<root>/<game>`    |
| `<winAppData>`         | `%APPDATA%`        | `~/.config`        | `~/.config`        |
| `<winLocalAppData>`    | `%LOCALAPPDATA%`   | `~/.local/share`   | `~/.local/share`   |
| `<winLocalAppDataLow>` | `AppData/LocalLow` | `~/.local/share`   | —                  |
| `<winDocuments>`       | Documents folder   | Documents folder   | Documents folder   |
| `<winPublic>`          | `%PUBLIC%`         | `/tmp`             | —                  |
| `<winProgramData>`     | `%PROGRAMDATA%`    | `/etc`             | —                  |
| `<winDir>`             | `%WINDIR%`         | `/usr`             | —                  |
| `<xdgData>`            | —                  | `$XDG_DATA_HOME`   | —                  |
| `<xdgConfig>`          | —                  | `$XDG_CONFIG_HOME` | —                  |
| `<storeUserId>`        | Store-specific ID  | Store-specific ID  | Store-specific ID  |
| `<osUserName>`         | OS username        | OS username        | OS username        |
| `<skip>`               | (excluded)         | (excluded)         | (excluded)         |

Absolute paths (like `D:\Games\Drop\...\drop-goldberg`) pass through the resolver unchanged — each path component that doesn't match a placeholder is kept as-is.

### Archive Format

Saves are stored as **tar.zst** archives (tar + Zstandard compression at level 22):

```
archive.tar.zst
├── {uuid-1}           ← save file, renamed to UUID
├── {uuid-2}/          ← save directory, renamed to UUID
│   ├── file1.sav
│   └── file2.dat
├── ...
└── metadata           ← JSON: CloudSaveMetadata
```

**Metadata file contents:**

```json
{
  "files": [
    {
      "conditions": [{ "Os": "Windows" }],
      "data_type": "File",
      "id": "{uuid-1}",
      "path": "<winAppData>/MyGame/saves",
      "tags": ["Save"]
    }
  ],
  "game_version": { "game_id": "...", "version_id": "..." },
  "save_id": ""
}
```

On extraction, the `id` field maps each UUID entry in the archive back to the resolved real path on disk.

### Upload Flow (Detailed)

```
1. Build CloudSaveMetadata from save path config
2. For each file entry:
   a. Check OS condition matches current platform
   b. Resolve placeholder path → real filesystem path
   c. Read file/directory from disk
   d. Append to tar archive under a new UUID
   e. Store UUID in metadata
3. Compress with zstd (level 22)
4. Embed metadata JSON as "metadata" entry in archive
5. Read archive bytes into memory
6. Ensure save slot exists (create if needed)
7. POST archive bytes to /api/v1/client/saves/{gameId}/{slotIndex}/push
8. Server:
   a. Streams upload to object storage
   b. Computes SHA256 hash in parallel
   c. Appends objectId to historyObjectIds
   d. Appends checksum to historyChecksums
   e. Trims history to saveSlotHistoryLimit (default 3)
   f. Updates lastUsedClientId and lastSyncedAt
```

### Download Flow (Detailed)

```
1. GET /sync-status → find latest objectId for the slot
2. GET /api/v1/object/{objectId} → download tar.zst bytes
3. Write to temp file
4. Decompress and untar to temp directory
5. Read "metadata" entry → parse CloudSaveMetadata
6. For each file in metadata:
   a. Check OS condition
   b. Resolve placeholder path → real destination
   c. Create parent directories
   d. Copy file/directory from temp to destination
```

### Conflict Detection

The system uses `lastUsedClientId` and checksums to detect conflicts:

- **Pre-launch:** If the latest save slot's `lastUsedClientId` differs from the current client, and the slot has data (checksum exists), the client emits `cloud_save_available` to prompt the user.
- **The UI offers:** "Use Local" (ignore cloud, will overwrite on exit) or "Download Cloud Save" (restore before playing).
- **Checksum comparison** enables future enhancement for smarter merge/skip decisions.

### Dual-Surface Behavior

| Feature              | Desktop Client (Tauri)           | Web UI |
| -------------------- | -------------------------------- | ------ |
| Auto-upload on exit  | Yes (if paths known)             | N/A    |
| Auto-check on launch | Yes (5s timeout)                 | N/A    |
| Manual upload        | Yes (Tauri command)              | No     |
| Manual download      | Yes (Tauri command + extraction) |
