# Mod System Architecture Plan

## Current State

Drop already has foundational pieces for a mod system, though none are wired up:

- `DownloadType::Mod` and `DownloadType::Dlc` exist in the Rust enum but are unused — only `Game` and `Tool` are active
- `GameVersion.requiredContent` is a self-referential Prisma relation defined in the schema but never populated during version import
- The import API accepts a `requiredContent: string[]` field but ignores it
- The versions endpoint dynamically builds dependency info from emulator references, not from the database relation
- No ROM patching infrastructure (xdelta/BPS/IPS) exists in either codebase
- No mod-related UI exists on either surface

## Design Principles

1. **Mods are Games** — A mod is just a Game with `type = Mod` that declares a parent. This reuses the entire existing pipeline (upload, manifest, delta, download, scan) with minimal new code.

2. **File overlay, not file patching** — Mods deliver complete replacement files that overlay onto the parent game's install directory. This is simpler, more reliable, and matches how most PC game mods work. ROM patches (xdelta/IPS) can be a Phase 2 addition.

3. **Mods install into the parent game's directory** — No separate mod folders. The download agent writes mod files directly into the parent game's install path, just like the game's own files. This means mods "just work" without launch command changes.

4. **Mod state is tracked per-mod** — Each installed mod has its own `.moddata` file and its own entry in `game_statuses` / `installed_game_version` so it can be individually installed, updated, and uninstalled.

5. **Both surfaces** — Mod browsing/discovery is a web page (embedded as iframe in client). Mod install/uninstall is native on the client (needs Tauri invoke). The game detail page shows installed mods natively.

## Data Model

### Server (Prisma)

```
Game
├── type: GameType  (add: Mod)
├── parentGameId: String?       ← NEW: which game this mod is for
├── parentGame: Game?           ← NEW: relation
├── mods: Game[]                ← NEW: reverse relation
└── ... existing fields

GameType enum:
  Game | Emulator | Dependency | Mod    ← add Mod
```

A Mod is a Game with `type = Mod` and `parentGameId` set. It has its own GameVersions, its own icon/banner/description, its own versions — the full Game lifecycle.

### Client (Rust)

```rust
// Existing — no change needed
pub enum DownloadType {
    Game,
    Tool,
    Dlc,
    Mod,  // Already defined, will now be used
}

// New struct for mod state tracking
pub struct ModData {
    pub mod_game_id: String,       // The mod's game ID
    pub parent_game_id: String,    // The parent game's ID
    pub mod_version: String,
    pub target_platform: Platform,
    pub installed_files: Vec<String>,  // Files this mod placed (for clean uninstall)
}
```

The `installed_files` list is critical — it records exactly which files the mod wrote so uninstalling a mod can remove only its files without touching the base game or other mods.

## Architecture

### How Mods Flow Through the System

```
Admin creates Mod game (type=Mod, parentGameId=X)
    ↓
Admin imports version (files go to library as normal)
    ↓
Store shows mod on parent game's page
    ↓
User clicks Install on mod
    ↓
Client resolves parent game's install_dir
    ↓
Download agent fetches mod manifest
    ↓
Mod files written INTO parent's install_dir
    ↓
.moddata file written to parent's install_dir
    ↓
Mod tracked in database as installed
```

### Install Directory Layout

```
<install_base>/Psychonauts (USA)/
├── .dropdata                    # Base game metadata
├── Psychonauts (USA).iso       # Base game files
├── .mods/                       # Mod metadata directory
│   ├── ra-compat-patch.moddata  # ModData for patch mod
│   └── hd-textures.moddata      # ModData for texture mod
└── ... (mod files mixed in with game files)
```

Mod files go directly into the game directory. The `.mods/` subfolder only stores metadata (which files each mod installed). This way:

- Game launches work without any command changes
- RetroArch/emulators see the patched files naturally
- PC games see replacement DLLs/assets naturally

### Uninstall Safety

When uninstalling a mod:

1. Read the mod's `.moddata` to get `installed_files`
2. For each file, check if any OTHER installed mod also claims that file
3. If no conflict, delete the file
4. If another mod also installed that file, leave it (last-writer-wins)
5. Optionally: restore original file from base game by re-downloading just that chunk

This is the trickiest part. A simpler V1 approach: "Verify Game" re-downloads the base game after mod removal, ensuring clean state.

## Implementation Plan

### Phase 1: Core Infrastructure

**Server:**

1. Add `Mod` to `GameType` enum in Prisma
2. Add `parentGameId` and relations to `Game` model
3. Migration for the new fields
4. Update game creation API to accept `parentGameId` for mod-type games
5. Add `GET /api/v1/games/{id}/mods` endpoint — returns mods for a parent game
6. Update store game page to show available mods

**Client:**

7. Add `.moddata` file format (similar to `.dropdata` but for mods)
8. Create `ModDownloadAgent` implementing `Downloadable` trait:
   - Resolves parent game's install_dir instead of creating a new directory
   - Writes files into parent's directory
   - Records installed files in `.moddata`
9. Add `download_mod` Tauri command
10. Add `uninstall_mod` Tauri command (deletes mod files + .moddata)
11. Add `list_installed_mods` Tauri command (scans .mods/ directory)

**UI (both surfaces):**

12. Mod listing on game store page (web, iframe in client)
13. "Installed Mods" section on native game page with enable/disable/uninstall
14. Mod install flow (similar to game install but simpler — no version selection needed for V1)

### Phase 2: ROM Patching

15. Bundle xdelta3 binary (like RAHasher) or add Rust xdelta crate
16. Add patch application step to `ModDownloadAgent`:
    - If mod contains `.xdelta`/`.bps`/`.ips` files alongside a target filename, apply the patch to the base file
    - Store original file hash in `.moddata` for restoration
17. Add patch reversal on mod uninstall (restore original from hash/re-download)

### Phase 3: Mod Management UX

18. Load order system (for mods that modify the same files)
19. Mod conflict detection (warn when two mods touch the same file)
20. "Verify Game Files" button that re-downloads base game to clean state
21. Mod collections / curated mod packs
22. Mod update notifications

## Detailed File Changes

### Server

| File                                         | Change                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| `prisma/models/content.prisma`               | Add `Mod` to GameType, add `parentGameId`/relations to Game |
| `prisma/migrations/...`                      | New migration                                               |
| `server/api/v1/admin/import/game.post.ts`    | Accept `parentGameId` for mod creation                      |
| `server/api/v1/games/[id]/mods.get.ts`       | NEW: List mods for a game                                   |
| `server/api/v1/client/game/[id]/mods.get.ts` | NEW: Client endpoint for mod listing                        |
| `pages/store/[id]/index.vue`                 | Show "Mods" tab/section                                     |
| `pages/admin/library/[id]/index.vue`         | Show parent game link for mods                              |
| `components/GameEditor/Metadata.vue`         | Parent game selector for mod-type games                     |

### Client

| File                                         | Change                                              |
| -------------------------------------------- | --------------------------------------------------- |
| `src-tauri/games/src/downloads/mod_data.rs`  | NEW: ModData struct and serialization               |
| `src-tauri/games/src/downloads/mod_agent.rs` | NEW: ModDownloadAgent                               |
| `src-tauri/src/downloads.rs`                 | Add `download_mod` command                          |
| `src-tauri/src/games.rs`                     | Add `list_installed_mods`, `uninstall_mod` commands |
| `src-tauri/src/lib.rs`                       | Register new commands                               |
| `main/pages/library/[id]/index.vue`          | "Installed Mods" section                            |

## Key Decisions to Make

1. **Can mods have mods?** — Probably not for V1. Keep it flat (mods can only target base games, not other mods).

2. **Do mods show in the main library?** — Probably not. They should be accessible from the parent game's page only. They don't need their own library card.

3. **Mod file conflicts** — When two mods write the same file, who wins? Options:
   - Last installed wins (simplest)
   - Load order system (more complex but needed eventually)
   - Block conflicting installs (safest but annoying)

4. **Mod compatibility with game updates** — When the base game updates, are mods invalidated? Options:
   - Mark mods as "possibly incompatible" after base game update
   - Let mods declare compatible version ranges
   - Do nothing (user responsibility)

5. **Admin vs user mod uploads** — V1: admin-only (mods are curated like games). V2: user uploads with approval flow.

## Estimated Effort

- Phase 1 (core): ~3-4 days of implementation
- Phase 2 (ROM patching): ~1-2 days
- Phase 3 (management UX): ~2-3 days

Phase 1 gets you a working mod system. Phases 2 and 3 add polish.
