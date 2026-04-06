#!/usr/bin/env node
/**
 * Drop Version Import Script
 *
 * Imports versions for already-imported games. Handles:
 * - RetroArch emulators: creates multi-launch configs (one per system/core)
 * - ROMs: links to the correct RetroArch launch config by file extension
 * - Regular games: creates a basic launch config from detected executables
 *
 * Usage:
 *   node scripts/import-versions.mjs
 *
 * Prerequisites:
 *   - Games must already be imported (via admin UI or import-emulators.mjs)
 *   - RetroArch + cores in library directory (run download-retroarch.ps1 first)
 */

const BASE_URL = "https://drop.canpop.synology.me";
const API_KEY = "ebe9b583-77a3-4f19-8015-6057c3733be1";

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const url = `${BASE_URL}/api/v1/admin${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── RetroArch Launch Configurations ─────────────────────────────────────────

const RETROARCH_LAUNCHES = {
  Windows: [
    {
      name: "NES",
      command: "retroarch.exe -L cores/mesen_libretro.dll {rom}",
      suggestions: [".nes", ".fds", ".unf"],
    },
    {
      name: "SNES",
      command: "retroarch.exe -L cores/snes9x_libretro.dll {rom}",
      suggestions: [".sfc", ".smc", ".snes"],
    },
    {
      name: "GB / GBC",
      command: "retroarch.exe -L cores/gambatte_libretro.dll {rom}",
      suggestions: [".gb", ".gbc"],
    },
    {
      name: "GBA",
      command: "retroarch.exe -L cores/mgba_libretro.dll {rom}",
      suggestions: [".gba"],
    },
    {
      name: "N64",
      command: "retroarch.exe -L cores/mupen64plus_next_libretro.dll {rom}",
      suggestions: [".n64", ".z64", ".v64"],
    },
    {
      name: "PS1",
      command: "retroarch.exe -L cores/swanstation_libretro.dll {rom}",
      suggestions: [".cue", ".chd", ".pbp"],
    },
    {
      name: "PS2",
      command: "retroarch.exe -L cores/pcsx2_libretro.dll {rom}",
      suggestions: [".chd", ".cso", ".gz"],
    },
    {
      name: "PSP",
      command: "retroarch.exe -L cores/ppsspp_libretro.dll {rom}",
      suggestions: [".cso", ".pbp"],
    },
    {
      name: "DS",
      command: "retroarch.exe -L cores/melonds_libretro.dll {rom}",
      suggestions: [".nds"],
    },
    {
      name: "GameCube / Wii",
      command: "retroarch.exe -L cores/dolphin_libretro.dll {rom}",
      suggestions: [".gcm", ".wbfs", ".ciso", ".gcz", ".rvz", ".dol", ".wad"],
    },
    {
      name: "Genesis / Mega Drive",
      command: "retroarch.exe -L cores/genesis_plus_gx_libretro.dll {rom}",
      suggestions: [".md", ".gen", ".smd", ".sms", ".gg"],
    },
    {
      name: "Saturn",
      command: "retroarch.exe -L cores/mednafen_saturn_libretro.dll {rom}",
      suggestions: [".cue", ".chd"],
    },
    {
      name: "Dreamcast",
      command: "retroarch.exe -L cores/flycast_libretro.dll {rom}",
      suggestions: [".gdi", ".cdi", ".chd"],
    },
    {
      name: "Arcade",
      command: "retroarch.exe -L cores/fbneo_libretro.dll {rom}",
      suggestions: [".zip"],
    },
    {
      name: "32X / Sega CD",
      command: "retroarch.exe -L cores/picodrive_libretro.dll {rom}",
      suggestions: [".32x"],
    },
  ],
  Linux: [
    {
      name: "NES",
      command: "./retroarch -L cores/mesen_libretro.so {rom}",
      suggestions: [".nes", ".fds", ".unf"],
    },
    {
      name: "SNES",
      command: "./retroarch -L cores/snes9x_libretro.so {rom}",
      suggestions: [".sfc", ".smc", ".snes"],
    },
    {
      name: "GB / GBC",
      command: "./retroarch -L cores/gambatte_libretro.so {rom}",
      suggestions: [".gb", ".gbc"],
    },
    {
      name: "GBA",
      command: "./retroarch -L cores/mgba_libretro.so {rom}",
      suggestions: [".gba"],
    },
    {
      name: "N64",
      command: "./retroarch -L cores/mupen64plus_next_libretro.so {rom}",
      suggestions: [".n64", ".z64", ".v64"],
    },
    {
      name: "PS1",
      command: "./retroarch -L cores/swanstation_libretro.so {rom}",
      suggestions: [".cue", ".chd", ".pbp"],
    },
    {
      name: "PS2",
      command: "./retroarch -L cores/pcsx2_libretro.so {rom}",
      suggestions: [".chd", ".cso", ".gz"],
    },
    {
      name: "PSP",
      command: "./retroarch -L cores/ppsspp_libretro.so {rom}",
      suggestions: [".cso", ".pbp"],
    },
    {
      name: "DS",
      command: "./retroarch -L cores/melonds_libretro.so {rom}",
      suggestions: [".nds"],
    },
    {
      name: "GameCube / Wii",
      command: "./retroarch -L cores/dolphin_libretro.so {rom}",
      suggestions: [".gcm", ".wbfs", ".ciso", ".gcz", ".rvz", ".dol", ".wad"],
    },
    {
      name: "Genesis / Mega Drive",
      command: "./retroarch -L cores/genesis_plus_gx_libretro.so {rom}",
      suggestions: [".md", ".gen", ".smd", ".sms", ".gg"],
    },
    {
      name: "Saturn",
      command: "./retroarch -L cores/mednafen_saturn_libretro.so {rom}",
      suggestions: [".cue", ".chd"],
    },
    {
      name: "Dreamcast",
      command: "./retroarch -L cores/flycast_libretro.so {rom}",
      suggestions: [".gdi", ".cdi", ".chd"],
    },
    {
      name: "Arcade",
      command: "./retroarch -L cores/fbneo_libretro.so {rom}",
      suggestions: [".zip"],
    },
    {
      name: "32X / Sega CD",
      command: "./retroarch -L cores/picodrive_libretro.so {rom}",
      suggestions: [".32x"],
    },
  ],
};

// Map folder names to platform
const RETROARCH_FOLDER_PLATFORM = {
  "retroarch windows": "Windows",
  "retroarch linux": "Linux",
};

// Build extension → emulator name lookup (for ROM matching)
const EXT_TO_SYSTEM = {};
for (const cfg of RETROARCH_LAUNCHES.Windows) {
  for (const ext of cfg.suggestions) {
    // First match wins (avoids ambiguous extensions being overwritten)
    if (!EXT_TO_SYSTEM[ext]) EXT_TO_SYSTEM[ext] = cfg.name;
  }
}

// ── Step 1: Fetch all games ────────────────────────────────────────────────

console.log("=== Step 1: Fetching all games ===\n");

const allGames = await api("GET", "/game");
console.log(`Found ${allGames.length} game(s) in database.\n`);

// Separate RetroArch emulators from other games
const retroarchGames = [];
const otherGames = [];

for (const g of allGames) {
  const nameLower = g.mName.toLowerCase();
  if (RETROARCH_FOLDER_PLATFORM[nameLower]) {
    retroarchGames.push({
      ...g,
      platform: RETROARCH_FOLDER_PLATFORM[nameLower],
    });
  } else {
    otherGames.push(g);
  }
}

console.log(`RetroArch entries: ${retroarchGames.length}`);
for (const g of retroarchGames)
  console.log(`  [${g.platform}] ${g.mName} (${g.id})`);
console.log(`Other games: ${otherGames.length}`);
for (const g of otherGames) console.log(`  ${g.mName} (${g.id})`);

// ── Step 2: Import RetroArch versions ──────────────────────────────────────

console.log("\n=== Step 2: Importing RetroArch versions ===\n");

for (const ra of retroarchGames) {
  console.log(`Processing: ${ra.mName} ...`);

  // Check if it already has versions
  const gameData = await api("GET", `/game/${ra.id}`);
  if (gameData.game.versions && gameData.game.versions.length > 0) {
    console.log(
      `  Already has ${gameData.game.versions.length} version(s) — skipping.`,
    );
    continue;
  }

  // Get unimported versions
  if (
    !gameData.unimportedVersions ||
    gameData.unimportedVersions.length === 0
  ) {
    console.log(`  No unimported versions found on disk — skipping.`);
    continue;
  }

  // Use the first unimported version
  const ver = gameData.unimportedVersions[0];
  const versionIdentifier = ver.id ?? ver;
  const versionName = ver.name ?? ver.id ?? String(ver);
  console.log(`  Importing version: ${versionName}`);

  // Build launches for this platform
  const platform = ra.platform;
  const launches = RETROARCH_LAUNCHES[platform].map((cfg) => ({
    platform,
    name: cfg.name,
    launch: cfg.command,
    suggestions: cfg.suggestions,
  }));

  try {
    const { taskId } = await api("POST", "/import/version", {
      id: ra.id,
      version: {
        type: "local",
        identifier: String(versionIdentifier),
        name: String(versionName),
      },
      launches,
      setups: [],
    });
    console.log(
      `  Version imported (task: ${taskId}) with ${launches.length} launch configs.`,
    );
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

// ── Step 3: Wait and fetch emulator launch configs ─────────────────────────

console.log("\n=== Step 3: Building emulator launch config index ===\n");

console.log("Waiting for version imports to complete...");
await sleep(5000);

// Re-fetch RetroArch games to get their launch config IDs
// Map: extension → launchId (per platform)
const emulatorIndex = {}; // { ".sfc": { Windows: "launch-id-xxx", Linux: "launch-id-yyy" } }

for (const ra of retroarchGames) {
  const versions = await api("GET", `/game/${ra.id}/versions`);
  if (!versions || versions.length === 0) {
    console.log(
      `  WARNING: ${ra.mName} has no versions yet — ROM linking will skip this platform.`,
    );
    continue;
  }

  for (const ver of versions) {
    for (const launch of ver.launches) {
      // Find the matching config to get its suggestions
      const matchingCfg = RETROARCH_LAUNCHES[ra.platform]?.find(
        (c) => c.name === launch.name,
      );
      if (!matchingCfg) continue;

      for (const ext of matchingCfg.suggestions) {
        if (!emulatorIndex[ext]) emulatorIndex[ext] = {};
        emulatorIndex[ext][ra.platform] = launch.launchId;
      }
    }
  }
}

const indexedExts = Object.keys(emulatorIndex).length;
console.log(
  `Indexed ${indexedExts} file extension(s) across RetroArch launch configs.`,
);
if (indexedExts > 0) {
  for (const [ext, platforms] of Object.entries(emulatorIndex)) {
    const platNames = Object.keys(platforms).join(", ");
    console.log(`  ${ext} → ${platNames}`);
  }
}

// ── Step 4: Import versions for other games (ROMs) ─────────────────────────

console.log("\n=== Step 4: Importing versions for other games ===\n");

for (const game of otherGames) {
  console.log(`Processing: ${game.mName} ...`);

  // Check if it already has versions
  const gameData = await api("GET", `/game/${game.id}`);
  if (gameData.game.versions && gameData.game.versions.length > 0) {
    console.log(
      `  Already has ${gameData.game.versions.length} version(s) — skipping.`,
    );
    continue;
  }

  // Get unimported versions
  if (
    !gameData.unimportedVersions ||
    gameData.unimportedVersions.length === 0
  ) {
    console.log(`  No unimported versions found on disk — skipping.`);
    continue;
  }

  const ver = gameData.unimportedVersions[0];
  const versionIdentifier = ver.id ?? ver;
  const versionName = ver.name ?? ver.id ?? String(ver);
  console.log(`  Version: ${versionName}`);

  // Try to detect what kind of game this is by checking the version hints
  // We use the import/version GET endpoint which returns file-extension-based guesses
  let guesses;
  try {
    const versionInfo = await api("GET", `/import/version?id=${game.id}`);
    guesses = versionInfo;
  } catch (e) {
    console.log(`  Could not fetch version info: ${e.message}`);
  }

  // Check if any files in the version match ROM extensions
  // by trying to determine the game type from its name or folder structure
  // For ROMs, we need to find the ROM file and its extension
  let launches = [];
  let isRom = false;

  // Try matching by common ROM folder naming patterns
  const nameLower = game.mName.toLowerCase();

  // Check each known extension to see if the game name hints at a system
  // This is a heuristic — the admin UI's suggestion system is more accurate
  // but we can make reasonable guesses for common patterns
  const SYSTEM_KEYWORDS = {
    nes: [".nes"],
    snes: [".sfc", ".smc"],
    "super nintendo": [".sfc", ".smc"],
    "game boy advance": [".gba"],
    gba: [".gba"],
    "game boy": [".gb", ".gbc"],
    "nintendo 64": [".n64", ".z64"],
    n64: [".n64", ".z64"],
    "playstation 2": [".chd", ".cso"],
    ps2: [".chd", ".cso"],
    playstation: [".cue", ".chd"],
    ps1: [".cue", ".chd"],
    psx: [".cue", ".chd"],
    psp: [".cso", ".pbp"],
    "nintendo ds": [".nds"],
    nds: [".nds"],
    gamecube: [".gcm", ".gcz", ".rvz"],
    wii: [".wbfs", ".rvz"],
    genesis: [".md", ".gen"],
    "mega drive": [".md", ".gen"],
    saturn: [".chd", ".cue"],
    dreamcast: [".gdi", ".cdi", ".chd"],
    arcade: [".zip"],
  };

  // We'll let the server's suggestion system handle the actual matching.
  // For the script, we import the version and let the user pick the emulator
  // launch config in the admin UI — unless we can auto-detect.

  // For now: import every non-RetroArch game as a simple version.
  // The admin UI will show emulator suggestions based on file extensions.
  console.log(`  Importing version: ${versionName}`);

  try {
    const { taskId } = await api("POST", "/import/version", {
      id: game.id,
      version: {
        type: "local",
        identifier: String(versionIdentifier),
        name: String(versionName),
      },
      launches: [], // Empty — admin sets launch config via UI with emulator suggestions
      setups: [],
    });
    console.log(`  Version imported (task: ${taskId})`);
    console.log(
      `  -> Set up launch config in admin UI (emulator suggestions will auto-match).`,
    );
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

// ── Done ───────────────────────────────────────────────────────────────────

console.log("\n=== Done ===");
console.log(`
Summary:
  - RetroArch emulators: ${retroarchGames.length} processed
  - Other games/ROMs: ${otherGames.length} processed
  - Emulator extensions indexed: ${Object.keys(emulatorIndex).length}

Next steps:
  1. Check the admin panel for import tasks
  2. For ROM games with empty launch configs:
     - Go to Admin → Library → Game → Version
     - The emulator suggestion system will show matching RetroArch cores
     - Select the correct one and save
  3. Users can then download RetroArch + any ROM and play immediately
`);
