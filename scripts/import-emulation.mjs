#!/usr/bin/env node
/**
 * Drop Emulation Library Import Script
 *
 * Imports all emulators and ROMs from Z:\media\emulation into Drop.
 *
 * Usage:
 *   node scripts/import-emulation.mjs [--step=N]
 *
 * Steps (runs all by default, or specify --step=N to run one):
 *   1 — Create library sources
 *   2 — Import emulator games
 *   3 — Import emulator versions (launch configs)
 *   4 — Import ROM games
 *   5 — Import ROM versions (linked to emulators)
 */

const BASE_URL = "https://drop.canpop.synology.me";
const API_KEY = "51e76c0a-1962-4245-998a-04a5506326d9";
const EMULATION_ROOT = "Z:\\media\\emulation";

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// ── API helper ─────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE_URL}/api/v1/admin${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTask(taskId, label) {
  process.stdout.write(`  ⏳ ${label}...`);
  // Tasks run asynchronously — poll until done (check every 2s, max 5min)
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    try {
      const { runningTasks } = await api("GET", "/task");
      if (!runningTasks.includes(taskId)) {
        console.log(" done");
        return;
      }
    } catch {
      // Ignore transient errors
    }
    process.stdout.write(".");
  }
  console.log(" (timed out, continuing)");
}

// ── Emulator definitions ───────────────────────────────────────────────────
// Maps emulator folder names to their configs

const EMULATORS = {
  // --- SNES (Snes9x) ---
  "SNES Windows": {
    system: "SNES",
    platform: "Windows",
    launch: "snes9x-x64.exe {rom}",
    suggestions: [".sfc", ".smc", ".snes"],
  },
  "SNES Linux": {
    system: "SNES",
    platform: "Linux",
    launch: "Snes9x.AppImage {rom}",
    suggestions: [".sfc", ".smc", ".snes"],
  },

  // --- GBA (mGBA) — also handles GB/GBC ---
  "GBA Windows": {
    system: "GBA",
    platform: "Windows",
    launch: "mGBA.exe {rom}",
    suggestions: [".gba", ".gb", ".gbc"],
  },
  "GBA Linux": {
    system: "GBA",
    platform: "Linux",
    launch: "mGBA.AppImage {rom}",
    suggestions: [".gba", ".gb", ".gbc"],
  },

  // --- N64 (simple64) ---
  "N64 Windows": {
    system: "N64",
    platform: "Windows",
    launch: "simple64-gui.exe {rom}",
    suggestions: [".n64", ".z64", ".v64"],
  },
  // No N64 Linux folder exists

  // --- DS (melonDS) ---
  "DS Windows": {
    system: "DS",
    platform: "Windows",
    launch: "melonDS.exe {rom}",
    suggestions: [".nds"],
  },
  "DS Linux": {
    system: "DS",
    platform: "Linux",
    launch: "melonDS-x86_64.AppImage {rom}",
    suggestions: [".nds"],
  },

  // --- PS1 (DuckStation) ---
  "PS1 Windows": {
    system: "PS1",
    platform: "Windows",
    launch: "duckstation-qt-x64-ReleaseLTCG.exe {rom}",
    suggestions: [".bin", ".cue", ".chd", ".iso", ".img", ".pbp"],
  },
  "PS1 Linux": {
    system: "PS1",
    platform: "Linux",
    launch: "DuckStation.AppImage {rom}",
    suggestions: [".bin", ".cue", ".chd", ".iso", ".img", ".pbp"],
  },

  // --- PS2 (PCSX2) ---
  "PS2 Windows": {
    system: "PS2",
    platform: "Windows",
    launch: "pcsx2-qt.exe {rom}",
    suggestions: [".iso", ".bin", ".chd", ".gz", ".cso"],
  },
  "PS2 Linux": {
    system: "PS2",
    platform: "Linux",
    launch: "PCSX2.AppImage {rom}",
    suggestions: [".iso", ".bin", ".chd", ".gz", ".cso"],
  },

  // --- PSP (PPSSPP) ---
  "PSP Windows": {
    system: "PSP",
    platform: "Windows",
    launch: "PPSSPPWindows64.exe {rom}",
    suggestions: [".iso", ".cso", ".pbp"],
  },
  "PSP Linux": {
    system: "PSP",
    platform: "Linux",
    launch: "PPSSPP.AppImage {rom}",
    suggestions: [".iso", ".cso", ".pbp"],
  },

  // --- GameCube / Wii (Dolphin) ---
  "Dolphin Windows": {
    system: "Dolphin",
    platform: "Windows",
    launch: "Dolphin.exe --exec={rom}",
    suggestions: [".iso", ".gcm", ".gcz", ".wbfs", ".rvz", ".wad"],
  },
  "Dolphin Linux": {
    system: "Dolphin",
    platform: "Linux",
    launch: "Dolphin.AppImage --exec={rom}",
    suggestions: [".iso", ".gcm", ".gcz", ".wbfs", ".rvz", ".wad"],
  },

  // --- WiiU (Cemu) ---
  "WiiU Windows": {
    system: "WiiU",
    platform: "Windows",
    launch: "Cemu.exe {rom}",
    suggestions: [".rpx", ".wud", ".wux", ".wua"],
  },
  "WiiU Linux": {
    system: "WiiU",
    platform: "Linux",
    launch: "Cemu.AppImage {rom}",
    suggestions: [".rpx", ".wud", ".wux", ".wua"],
  },

  // --- Xbox (xemu) ---
  "Xbox Windows": {
    system: "Xbox",
    platform: "Windows",
    launch: "xemu.exe -dvd_path {rom}",
    suggestions: [".iso", ".xiso"],
  },
  "Xbox Linux": {
    system: "Xbox",
    platform: "Linux",
    launch: "xemu.AppImage -dvd_path {rom}",
    suggestions: [".iso", ".xiso"],
  },

  // --- Switch (Ryujinx) ---
  "Switch Windows": {
    system: "Switch",
    platform: "Windows",
    launch: "publish/Ryujinx.exe {rom}",
    suggestions: [".xci", ".nsp"],
  },
  "Switch Linux": {
    system: "Switch",
    platform: "Linux",
    launch: "Ryujinx.AppImage {rom}",
    suggestions: [".xci", ".nsp"],
  },
};

// Maps ROM system folders → which emulator system they use
const ROM_SYSTEM_MAP = {
  SNES: "SNES",
  GBA: "GBA",
  GBC: "GBA", // mGBA handles GBC
  N64: "N64",
  PS1: "PS1",
  PS2: "PS2",
  GameCube: "Dolphin",
  Wii: "Dolphin",
  Switch: "Switch",
};

const ROM_SYSTEMS = Object.keys(ROM_SYSTEM_MAP);

// ── Step 1: Create library sources ─────────────────────────────────────────

async function step1_createLibraries() {
  console.log("\n=== Step 1: Creating library sources ===\n");

  const existing = await api("GET", "/library/libraries");
  const existingPaths = new Set(
    existing.map((l) => l.options?.baseDir?.replace(/\//g, "\\")),
  );

  const librariesToCreate = [];

  // Emulators library
  const emuPath = `${EMULATION_ROOT}\\Emulators`;
  if (!existingPaths.has(emuPath)) {
    librariesToCreate.push({
      name: "Emulators",
      backend: "FlatFilesystem",
      options: { baseDir: emuPath },
    });
  } else {
    console.log(`  ✓ Emulators library already exists`);
  }

  // Per-system ROM libraries
  for (const system of ROM_SYSTEMS) {
    const romPath = `${EMULATION_ROOT}\\Roms\\${system}`;
    if (!existingPaths.has(romPath)) {
      librariesToCreate.push({
        name: `ROMs: ${system}`,
        backend: "FlatFilesystem",
        options: { baseDir: romPath },
      });
    } else {
      console.log(`  ✓ ROMs: ${system} library already exists`);
    }
  }

  for (const lib of librariesToCreate) {
    try {
      const result = await api("POST", "/library/sources", lib);
      console.log(`  ✓ Created "${lib.name}" (${result.id})`);
    } catch (e) {
      console.log(`  ✗ Failed "${lib.name}": ${e.message}`);
    }
  }

  console.log("\nLibrary sources ready.");
}

// ── Step 2: Import emulator games ──────────────────────────────────────────

async function step2_importEmulatorGames() {
  console.log("\n=== Step 2: Importing emulator games ===\n");

  const { unimportedGames } = await api("GET", "/import/game");
  const libraries = await api("GET", "/library/libraries");

  // Find the emulators library
  const emuLib = libraries.find(
    (l) =>
      l.options?.baseDir?.replace(/\//g, "\\") ===
      `${EMULATION_ROOT}\\Emulators`,
  );
  if (!emuLib) {
    console.log("  ✗ Emulators library not found. Run step 1 first.");
    return;
  }

  const emuUnimported = unimportedGames.filter(
    (g) => g.library.id === emuLib.id,
  );

  if (emuUnimported.length === 0) {
    console.log("  All emulators already imported.");
    return;
  }

  for (const game of emuUnimported) {
    const config = EMULATORS[game.game];
    if (!config) {
      console.log(`  ⚠ Unknown emulator folder: ${game.game} — skipping`);
      continue;
    }

    try {
      const { taskId } = await api("POST", "/import/game", {
        library: emuLib.id,
        path: game.game,
        type: "Emulator",
      });
      console.log(`  ✓ Imported "${game.game}" (task: ${taskId})`);
    } catch (e) {
      console.log(`  ✗ Failed "${game.game}": ${e.message}`);
    }
  }
}

// ── Step 3: Import emulator versions ───────────────────────────────────────

async function step3_importEmulatorVersions() {
  console.log(
    "\n=== Step 3: Importing emulator versions (launch configs) ===\n",
  );

  const libraries = await api("GET", "/library/libraries");
  const emuLib = libraries.find(
    (l) =>
      l.options?.baseDir?.replace(/\//g, "\\") ===
      `${EMULATION_ROOT}\\Emulators`,
  );
  if (!emuLib) {
    console.log("  ✗ Emulators library not found.");
    return;
  }

  // Get all games in the emulators library
  const allGames = await api("GET", "/game");
  const emuGames = [];

  for (const game of allGames) {
    try {
      const { game: full } = await api("GET", `/game/${game.id}`);
      if (full.libraryId === emuLib.id) {
        emuGames.push(full);
      }
    } catch {
      // Skip games we can't fetch
    }
  }

  for (const game of emuGames) {
    const config = EMULATORS[game.libraryPath];
    if (!config) {
      console.log(`  ⚠ No config for "${game.mName}" (${game.libraryPath})`);
      continue;
    }

    // Check if already has a version
    if (game.versions && game.versions.length > 0) {
      console.log(`  ✓ "${game.mName}" already has version imported`);
      continue;
    }

    // Get unimported versions
    try {
      const { versions } = await api("GET", `/import/version?id=${game.id}`);

      if (!versions || versions.length === 0) {
        console.log(`  ⚠ No unimported versions for "${game.mName}"`);
        continue;
      }

      // FlatFilesystem always returns "default" as version
      const version = versions[0];

      const { taskId } = await api("POST", "/import/version", {
        id: game.id,
        version: {
          type: version.type,
          identifier: version.identifier,
          name: version.name,
        },
        launches: [
          {
            platform: config.platform,
            name: `${config.system} (${config.platform})`,
            launch: config.launch,
            suggestions: config.suggestions,
          },
        ],
        setups: [],
      });

      await waitForTask(taskId, `"${game.mName}" version import`);
    } catch (e) {
      console.log(`  ✗ Failed "${game.mName}": ${e.message}`);
    }
  }
}

// ── Step 4: Import ROM games ───────────────────────────────────────────────

async function step4_importRomGames() {
  console.log("\n=== Step 4: Importing ROM games ===\n");

  const { unimportedGames } = await api("GET", "/import/game");
  const libraries = await api("GET", "/library/libraries");

  // Find ROM libraries
  const romLibs = {};
  for (const system of ROM_SYSTEMS) {
    const romPath = `${EMULATION_ROOT}\\Roms\\${system}`;
    const lib = libraries.find(
      (l) => l.options?.baseDir?.replace(/\//g, "\\") === romPath,
    );
    if (lib) romLibs[system] = lib;
  }

  for (const system of ROM_SYSTEMS) {
    const lib = romLibs[system];
    if (!lib) {
      console.log(`  ⚠ No library for ROMs: ${system}`);
      continue;
    }

    const systemUnimported = unimportedGames.filter(
      (g) => g.library.id === lib.id,
    );

    if (systemUnimported.length === 0) {
      console.log(`  ✓ ${system}: all games already imported`);
      continue;
    }

    console.log(`  ${system}: importing ${systemUnimported.length} games...`);

    for (const game of systemUnimported) {
      try {
        const { taskId } = await api("POST", "/import/game", {
          library: lib.id,
          path: game.game,
          type: "Game",
        });
        console.log(`    ✓ ${game.game}`);
      } catch (e) {
        console.log(`    ✗ ${game.game}: ${e.message}`);
      }
    }
  }
}

// ── Step 5: Import ROM versions ────────────────────────────────────────────

async function step5_importRomVersions() {
  console.log(
    "\n=== Step 5: Importing ROM versions (linked to emulators) ===\n",
  );

  // First, collect all emulator launch IDs
  console.log("  Collecting emulator launch configs...");

  const libraries = await api("GET", "/library/libraries");
  const emuLib = libraries.find(
    (l) =>
      l.options?.baseDir?.replace(/\//g, "\\") ===
      `${EMULATION_ROOT}\\Emulators`,
  );

  // Build a map: system → { Windows: launchId, Linux: launchId }
  const emulatorLaunchIds = {};
  const allGames = await api("GET", "/game");

  for (const game of allGames) {
    try {
      const { game: full } = await api("GET", `/game/${game.id}`);
      if (full.libraryId !== emuLib?.id) continue;

      const config = EMULATORS[full.libraryPath];
      if (!config) continue;

      for (const version of full.versions || []) {
        for (const launch of version.launches || []) {
          if (!emulatorLaunchIds[config.system]) {
            emulatorLaunchIds[config.system] = {};
          }
          emulatorLaunchIds[config.system][launch.platform] = launch.launchId;
          console.log(
            `    ${config.system} ${launch.platform} → ${launch.launchId}`,
          );
        }
      }
    } catch {
      // Skip
    }
  }

  // Now import ROM versions
  const romLibs = {};
  for (const system of ROM_SYSTEMS) {
    const romPath = `${EMULATION_ROOT}\\Roms\\${system}`;
    const lib = libraries.find(
      (l) => l.options?.baseDir?.replace(/\//g, "\\") === romPath,
    );
    if (lib) romLibs[system] = lib;
  }

  for (const system of ROM_SYSTEMS) {
    const lib = romLibs[system];
    if (!lib) continue;

    const emuSystem = ROM_SYSTEM_MAP[system];
    const emuLaunches = emulatorLaunchIds[emuSystem];
    if (!emuLaunches) {
      console.log(
        `\n  ⚠ No emulator launch configs found for ${system} (${emuSystem})`,
      );
      continue;
    }

    console.log(`\n  ${system}:`);

    // Get all games in this library
    for (const game of allGames) {
      let full;
      try {
        const result = await api("GET", `/game/${game.id}`);
        full = result.game;
      } catch {
        continue;
      }

      if (full.libraryId !== lib.id) continue;

      // Skip if already has versions
      if (full.versions && full.versions.length > 0) {
        console.log(`    ✓ "${full.mName}" already has version`);
        continue;
      }

      try {
        const { versions } = await api("GET", `/import/version?id=${full.id}`);
        if (!versions || versions.length === 0) continue;

        const version = versions[0];

        // Build launch configs for each available platform
        const launches = [];
        for (const [platform, launchId] of Object.entries(emuLaunches)) {
          launches.push({
            platform,
            name: `Play (${platform})`,
            launch: "{rom}",
            emulatorId: launchId,
          });
        }

        if (launches.length === 0) {
          console.log(`    ⚠ No emulator platforms for "${full.mName}"`);
          continue;
        }

        const { taskId } = await api("POST", "/import/version", {
          id: full.id,
          version: {
            type: version.type,
            identifier: version.identifier,
            name: version.name,
          },
          launches,
          setups: [],
        });

        await waitForTask(taskId, full.mName);
      } catch (e) {
        console.log(`    ✗ "${full.mName}": ${e.message}`);
      }
    }
  }

  // Output the emulator launch IDs for drop-app/emulator-launchids.json
  console.log(
    "\n\n  === Emulator Launch IDs (for emulator-launchids.json) ===",
  );
  console.log(JSON.stringify(emulatorLaunchIds, null, 2));
}

// ── Main ───────────────────────────────────────────────────────────────────

const stepArg = process.argv.find((a) => a.startsWith("--step="));
const step = stepArg ? parseInt(stepArg.split("=")[1]) : null;

console.log("╔══════════════════════════════════════╗");
console.log("║  Drop Emulation Library Importer     ║");
console.log("╚══════════════════════════════════════╝");

try {
  if (!step || step === 1) await step1_createLibraries();
  if (!step || step === 2) await step2_importEmulatorGames();
  if (!step || step === 3) await step3_importEmulatorVersions();
  if (!step || step === 4) await step4_importRomGames();
  if (!step || step === 5) await step5_importRomVersions();

  console.log("\n✅ Done! Check the admin panel to verify imports.");
} catch (e) {
  console.error("\n❌ Fatal error:", e.message);
  process.exit(1);
}
