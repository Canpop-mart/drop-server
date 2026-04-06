#!/usr/bin/env node
/**
 * Drop Emulator & ROM Import Script
 *
 * Usage:
 *   node scripts/import-emulators.mjs [--step=N]
 *
 * This script connects to the Drop API and:
 * 1. Lists available libraries and unimported games
 * 2. Categorises games as emulators vs ROMs
 * 3. Imports emulators (creates game entries)
 * 4. Imports RetroArch versions with per-system launch configs
 * 5. Imports ROM games
 *
 * Prerequisites:
 *   - API token with: import:game:read, import:game:new, import:version:read, import:version:new, game:read
 *   - RetroArch + cores must be in the library directory (run download-retroarch.ps1 first)
 */

const BASE_URL = "https://drop.canpop.synology.me";
const API_KEY = "51e76c0a-1962-4245-998a-04a5506326d9";

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
// One entry per system/core. Each gets its own LaunchConfiguration in the DB.
// The emulatorSuggestions (file extensions) enable automatic ROM-to-emulator matching.

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

// RetroArch folder names in the library (must match what download-retroarch.ps1 outputs)
const RETROARCH_FOLDERS = {
  "RetroArch Windows": "Windows",
  "RetroArch Linux": "Linux",
};

// Known emulator folder names (non-RetroArch standalone emulators)
const EMULATOR_NAMES = new Set([
  "RPCS3",
  "rpcs3",
  "Dolphin",
  "dolphin",
  "PCSX2",
  "pcsx2",
  "Cemu",
  "cemu",
  "Xemu",
  "xemu",
  "Xenia",
  "xenia",
  "DuckStation",
  "duckstation",
  "PPSSPP",
  "ppsspp",
  "mGBA",
  "mgba",
  "Ryujinx",
  "ryujinx",
  "yuzu",
]);

// File extensions for ROM detection
const ROM_EXTENSIONS = new Set([
  ".snes",
  ".sfc",
  ".smc",
  ".nes",
  ".nez",
  ".fds",
  ".unf",
  ".gba",
  ".gbc",
  ".gb",
  ".n64",
  ".z64",
  ".v64",
  ".nds",
  ".iso",
  ".bin",
  ".cue",
  ".chd",
  ".gcm",
  ".gcz",
  ".wbfs",
  ".wad",
  ".rvz",
  ".ciso",
  ".dol",
  ".rpx",
  ".xci",
  ".nsp",
  ".cso",
  ".pbp",
  ".md",
  ".gen",
  ".smd",
  ".sms",
  ".gg",
  ".gdi",
  ".cdi",
  ".32x",
  ".zip",
]);

// ── Step 1: Discover what's available ──────────────────────────────────────

console.log("=== Step 1: Discovering libraries and unimported games ===\n");

const libraries = await api("GET", "/library/sources");
console.log("Libraries:");
for (const lib of libraries) {
  console.log(
    `  [${lib.id}] ${lib.name} — ${lib.path} (working: ${lib.working})`,
  );
}

console.log("\nUnimported games:");
const { unimportedGames } = await api("GET", "/import/game");
for (const item of unimportedGames) {
  console.log(
    `  [${item.library.id}] ${item.game} (library: ${item.library.name})`,
  );
}

if (unimportedGames.length === 0) {
  console.log(
    "  (none found — all games already imported, or emulation path not configured as a library)",
  );
  process.exit(0);
}

// ── Step 2: Categorise what we found ───────────────────────────────────────

console.log("\n=== Step 2: Categorising games ===\n");

const retroarchEntries = [];
const standaloneEmulators = [];
const roms = [];

for (const item of unimportedGames) {
  const name = item.game;
  if (RETROARCH_FOLDERS[name]) {
    retroarchEntries.push(item);
  } else if (EMULATOR_NAMES.has(name)) {
    standaloneEmulators.push(item);
  } else {
    roms.push(item);
  }
}

console.log(`RetroArch entries: ${retroarchEntries.length}`);
for (const e of retroarchEntries) console.log(`  [RetroArch] ${e.game}`);

console.log(`Standalone emulators: ${standaloneEmulators.length}`);
for (const e of standaloneEmulators) console.log(`  [Emulator]  ${e.game}`);

console.log(`ROM / game candidates: ${roms.length}`);
for (const r of roms) console.log(`  [ROM/Game]  ${r.game}`);

// ── Step 3: Import RetroArch as emulator games ────────────────────────────

console.log("\n=== Step 3: Importing RetroArch emulator entries ===\n");

const importedRetroArch = {};

for (const entry of retroarchEntries) {
  console.log(`Importing emulator: ${entry.game} ...`);
  try {
    const { taskId } = await api("POST", "/import/game", {
      library: entry.library.id,
      path: entry.game,
      type: "Emulator",
    });
    console.log(`  Created game (task: ${taskId})`);
    importedRetroArch[entry.game] = { taskId, libraryId: entry.library.id };
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

// Import standalone emulators too
for (const emu of standaloneEmulators) {
  console.log(`Importing standalone emulator: ${emu.game} ...`);
  try {
    const { taskId } = await api("POST", "/import/game", {
      library: emu.library.id,
      path: emu.game,
      type: "Emulator",
    });
    console.log(`  Created game (task: ${taskId})`);
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

// ── Step 4: Wait for imports, then create RetroArch versions ──────────────

if (Object.keys(importedRetroArch).length > 0) {
  console.log(
    "\n=== Step 4: Creating RetroArch versions with launch configs ===\n",
  );

  // Wait for game creation tasks to complete
  console.log("Waiting for game creation tasks to finish...");
  await sleep(5000);

  // Find the RetroArch game IDs by searching all games (returns [{id, mName}])
  const allGames = await api("GET", "/game");

  for (const [folderName, platform] of Object.entries(RETROARCH_FOLDERS)) {
    if (!importedRetroArch[folderName]) continue;

    // Find the game by matching name (the server sets mName from the folder name)
    const game = allGames.find(
      (g) =>
        g.mName === folderName ||
        g.mName.toLowerCase() === folderName.toLowerCase(),
    );

    if (!game) {
      console.log(
        `  Could not find game entry for "${folderName}" — it may still be processing.`,
      );
      console.log(
        `  Try running this script again, or import the version manually via the admin UI.`,
      );
      continue;
    }

    console.log(`  Found "${folderName}" → game ID: ${game.id}`);

    // Fetch unimported versions for this game
    const { versions } = await api("GET", `/import/version?id=${game.id}`);
    if (!versions || versions.length === 0) {
      console.log(`  No unimported versions found for "${folderName}".`);
      continue;
    }

    const versionPath = versions[0]; // Use the first available version
    console.log(`  Importing version: ${versionPath}`);

    // Build the launches array for this platform
    const launches = RETROARCH_LAUNCHES[platform].map((cfg) => ({
      platform: platform === "Linux" ? "Linux" : "Windows",
      name: cfg.name,
      launch: cfg.command,
      suggestions: cfg.suggestions,
    }));

    try {
      const { taskId } = await api("POST", "/import/version", {
        id: game.id,
        version: {
          type: "local",
          identifier: versionPath,
          name: versionPath,
        },
        launches,
        setups: [],
      });
      console.log(
        `  Version imported (task: ${taskId}) with ${launches.length} launch configs:`,
      );
      for (const l of launches) {
        console.log(`    - ${l.name}: ${l.suggestions.join(", ")}`);
      }
    } catch (e) {
      console.log(`  Version import failed: ${e.message}`);
    }
  }
} else {
  console.log(
    "\n=== Step 4: Skipped (no new RetroArch entries to process) ===\n",
  );
}

// ── Step 5: Import ROMs as regular games ───────────────────────────────────

console.log("\n=== Step 5: Importing ROM games ===\n");

for (const rom of roms) {
  console.log(`Importing game: ${rom.game} ...`);
  try {
    const { taskId } = await api("POST", "/import/game", {
      library: rom.library.id,
      path: rom.game,
      type: "Game",
    });
    console.log(`  Created game (task: ${taskId})`);
  } catch (e) {
    console.log(`  Failed: ${e.message}`);
  }
}

// ── Done ───────────────────────────────────────────────────────────────────

console.log("\n=== Done ===");
console.log(`
Next steps:
1. Check the admin panel for import tasks
2. For each ROM game: import its version via the admin UI
   - The emulator suggestion system will auto-match ROMs to RetroArch cores
     based on file extension (e.g., .sfc → SNES → snes9x core)
   - Select the suggested emulator launch config when importing
3. Users can then download RetroArch + any ROM and play immediately
`);
