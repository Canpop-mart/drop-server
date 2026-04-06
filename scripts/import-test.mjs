#!/usr/bin/env node
/**
 * Drop Emulation Import — Test Run
 *
 * Tests with: SNES Windows (Snes9x) + Chrono Trigger (USA)
 *
 * Usage:
 *   node scripts/import-test.mjs
 */

const BASE_URL = "https://drop.canpop.synology.me";
const API_KEY = "51e76c0a-1962-4245-998a-04a5506326d9";
const EMULATION_ROOT = "Z:\\media\\emulation";

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const url = `${BASE_URL}/api/v1/admin${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
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
  process.stdout.write(`  ⏳ ${label}`);
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    try {
      const { runningTasks } = await api("GET", "/task");
      if (!runningTasks.includes(taskId)) {
        console.log(" ✓ done");
        return;
      }
    } catch {}
    process.stdout.write(".");
  }
  console.log(" (timed out)");
}

// ═══════════════════════════════════════════════════════════════════════════

console.log("╔══════════════════════════════════════════╗");
console.log("║  Drop Emulation Import — Test Run        ║");
console.log("║  SNES Windows + Chrono Trigger           ║");
console.log("╚══════════════════════════════════════════╝\n");

// ── 1. Create library sources ──────────────────────────────────────────────

console.log("=== 1. Library Sources ===\n");

const existingLibs = await api("GET", "/library/sources");
console.log(`  Found ${existingLibs.length} existing libraries`);
for (const lib of existingLibs) {
  console.log(
    `    - "${lib.name}" [${lib.backend}] → ${lib.options?.baseDir ?? "(no baseDir)"} (${lib.id})`,
  );
}

// Emulators library — match by name or path substring
let emuLib = existingLibs.find(
  (l) => l.name === "Emulators" || l.options?.baseDir?.includes("Emulators"),
);

if (!emuLib) {
  console.error(
    "  ✗ No Emulators library found. Create one in the admin panel first.",
  );
  process.exit(1);
}
console.log(`  ✓ Emulators library: "${emuLib.name}" (${emuLib.id})`);
console.log(`    Backend: ${emuLib.backend}, Path: ${emuLib.options?.baseDir}`);

// SNES ROMs library — match by name or path substring
let snesLib = existingLibs.find(
  (l) => l.name === "Super Nintendo" || l.options?.baseDir?.includes("SNES"),
);

if (!snesLib) {
  console.error(
    "  ✗ No SNES library found. Create one in the admin panel first.",
  );
  process.exit(1);
}
console.log(`  ✓ SNES library: "${snesLib.name}" (${snesLib.id})`);
console.log(
  `    Backend: ${snesLib.backend}, Path: ${snesLib.options?.baseDir}`,
);

// ── 2. Search metadata for both ────────────────────────────────────────────

console.log("\n=== 2. Metadata Search ===\n");

// Search for Snes9x metadata
let snesxMetadata = null;
try {
  const results = await api("GET", "/import/game/search?q=Snes9x");
  if (results.length > 0) {
    snesxMetadata = results[0];
    console.log(
      `  Snes9x metadata: "${snesxMetadata.name}" (${snesxMetadata.sourceId}:${snesxMetadata.id})`,
    );
  } else {
    console.log("  ⚠ No metadata found for Snes9x (will import without)");
  }
} catch (e) {
  console.log(`  ⚠ Metadata search failed for Snes9x: ${e.message}`);
  console.log("    (Will import without metadata — you can add it later)");
}

// Search for Chrono Trigger metadata
let chronoMetadata = null;
try {
  const results = await api("GET", "/import/game/search?q=Chrono+Trigger");
  if (results.length > 0) {
    // Find the SNES version specifically
    chronoMetadata =
      results.find((r) => r.name?.toLowerCase().includes("chrono trigger")) ||
      results[0];
    console.log(
      `  Chrono Trigger metadata: "${chronoMetadata.name}" (${chronoMetadata.sourceId}:${chronoMetadata.id})`,
    );
  } else {
    console.log("  ⚠ No metadata found for Chrono Trigger");
  }
} catch (e) {
  console.log(`  ⚠ Metadata search failed for Chrono Trigger: ${e.message}`);
}

// ── 3. Import SNES Windows emulator ────────────────────────────────────────

console.log("\n=== 3. Import SNES Windows Emulator ===\n");

// Check if already imported
const { unimportedGames } = await api("GET", "/import/game");
const snesEmuUnimported = unimportedGames.find(
  (g) => g.library.id === emuLib.id && g.game === "SNES Windows",
);

let snesEmuGameId = null;

if (snesEmuUnimported) {
  console.log("  Importing SNES Windows as Emulator...");

  const importBody = {
    library: emuLib.id,
    path: "SNES Windows",
    type: "Emulator",
  };

  // Attach metadata if found
  if (snesxMetadata) {
    importBody.metadata = {
      id: snesxMetadata.id,
      sourceId: snesxMetadata.sourceId,
      name: snesxMetadata.name,
    };
  }

  try {
    const { taskId } = await api("POST", "/import/game", importBody);
    await waitForTask(taskId, "Importing SNES Windows game entry");
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
} else {
  console.log(
    "  SNES Windows already imported (or not found in unimported list)",
  );
}

// Find the game ID
const allGames = await api("GET", "/game");
for (const g of allGames) {
  try {
    const { game: full } = await api("GET", `/game/${g.id}`);
    if (full.libraryId === emuLib.id && full.libraryPath === "SNES Windows") {
      snesEmuGameId = full.id;
      console.log(`  ✓ SNES Windows game ID: ${snesEmuGameId}`);
      console.log(`    Name: ${full.mName}`);
      console.log(`    Has icon: ${!!full.mIconObjectId}`);
      console.log(`    Has banner: ${!!full.mBannerObjectId}`);
      console.log(`    Versions: ${full.versions?.length || 0}`);
      break;
    }
  } catch {}
}

if (!snesEmuGameId) {
  console.log("  ✗ Could not find SNES Windows game — aborting");
  process.exit(1);
}

// ── 4. Import emulator version ─────────────────────────────────────────────

console.log("\n=== 4. Import SNES Windows Version ===\n");

const { game: emuGame } = await api("GET", `/game/${snesEmuGameId}`);

if (emuGame.versions?.length > 0) {
  console.log(`  Already has ${emuGame.versions.length} version(s)`);
  const launch = emuGame.versions[0]?.launches?.[0];
  if (launch) {
    console.log(`  Launch ID: ${launch.launchId}`);
    console.log(`  Command: ${launch.command ?? launch.name}`);
  }
} else {
  const { versions } = await api("GET", `/import/version?id=${snesEmuGameId}`);
  console.log(
    `  Available versions: ${JSON.stringify(versions.map((v) => v.name))}`,
  );

  if (versions.length > 0) {
    const version = versions[0];

    // Get version preload to see files
    try {
      const preload = await api(
        "GET",
        `/import/version/preload?id=${snesEmuGameId}&type=${version.type}&version=${encodeURIComponent(version.identifier)}`,
      );
      console.log(`  Files found: ${preload.length}`);
      const exes = preload.filter((f) => f.type === "platform");
      console.log(`  Executables: ${exes.map((e) => e.filename).join(", ")}`);
    } catch (e) {
      console.log(`  ⚠ Preload failed: ${e.message}`);
    }

    console.log("  Importing version...");
    const { taskId } = await api("POST", "/import/version", {
      id: snesEmuGameId,
      version: {
        type: version.type,
        identifier: version.identifier,
        name: version.name,
      },
      launches: [
        {
          platform: "Windows",
          name: "SNES (Windows)",
          launch: "snes9x-x64.exe {rom}",
          suggestions: [".sfc", ".smc", ".snes"],
        },
      ],
      setups: [],
    });

    await waitForTask(taskId, "SNES Windows version import");
  }
}

// Re-fetch to get the launch ID
const { game: emuGameUpdated } = await api("GET", `/game/${snesEmuGameId}`);
const snesLaunch = emuGameUpdated.versions?.[0]?.launches?.[0];
if (!snesLaunch) {
  console.log("  ✗ No launch config found after import — aborting");
  process.exit(1);
}
console.log(`  ✓ SNES Windows launch ID: ${snesLaunch.launchId}`);
console.log(`    Command: ${snesLaunch.command}`);
console.log(
  `    Suggestions: ${JSON.stringify(snesLaunch.emulatorSuggestions)}`,
);

// ── 5. Import Chrono Trigger ───────────────────────────────────────────────

console.log("\n=== 5. Import Chrono Trigger (USA) ===\n");

const chronoUnimported = unimportedGames.find(
  (g) => g.library.id === snesLib.id && g.game === "Chrono Trigger (USA)",
);

let chronoGameId = null;

if (chronoUnimported) {
  console.log("  Importing Chrono Trigger...");

  const importBody = {
    library: snesLib.id,
    path: "Chrono Trigger (USA)",
    type: "Game",
  };

  if (chronoMetadata) {
    importBody.metadata = {
      id: chronoMetadata.id,
      sourceId: chronoMetadata.sourceId,
      name: chronoMetadata.name,
    };
  }

  try {
    const { taskId } = await api("POST", "/import/game", importBody);
    await waitForTask(taskId, "Importing Chrono Trigger game entry");
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
} else {
  console.log("  Chrono Trigger already imported (or not in unimported list)");
}

// Find the game
const allGamesAfter = await api("GET", "/game");
for (const g of allGamesAfter) {
  try {
    const { game: full } = await api("GET", `/game/${g.id}`);
    if (
      full.libraryId === snesLib.id &&
      full.libraryPath === "Chrono Trigger (USA)"
    ) {
      chronoGameId = full.id;
      console.log(`  ✓ Chrono Trigger game ID: ${chronoGameId}`);
      console.log(`    Name: ${full.mName}`);
      console.log(`    Has icon: ${!!full.mIconObjectId}`);
      console.log(`    Has banner: ${!!full.mBannerObjectId}`);
      console.log(`    Has cover: ${!!full.mCoverObjectId}`);
      console.log(
        `    Description: ${full.mShortDescription ? full.mShortDescription.substring(0, 80) + "..." : "(none)"}`,
      );
      console.log(`    Versions: ${full.versions?.length || 0}`);
      break;
    }
  } catch {}
}

if (!chronoGameId) {
  console.log("  ✗ Could not find Chrono Trigger game — aborting");
  process.exit(1);
}

// ── 6. Import Chrono Trigger version (linked to SNES emulator) ─────────────

console.log("\n=== 6. Import Chrono Trigger Version ===\n");

const { game: chronoGame } = await api("GET", `/game/${chronoGameId}`);

if (chronoGame.versions?.length > 0) {
  console.log(`  Already has ${chronoGame.versions.length} version(s)`);
  for (const v of chronoGame.versions) {
    for (const l of v.launches) {
      console.log(
        `  Launch: ${l.name} (${l.platform}) → emulatorId: ${l.emulatorId || "none"}`,
      );
    }
  }
} else {
  const { versions } = await api("GET", `/import/version?id=${chronoGameId}`);
  console.log(
    `  Available versions: ${JSON.stringify(versions.map((v) => v.name))}`,
  );

  if (versions.length > 0) {
    const version = versions[0];

    // Preload to see ROM files
    try {
      const preload = await api(
        "GET",
        `/import/version/preload?id=${chronoGameId}&type=${version.type}&version=${encodeURIComponent(version.identifier)}`,
      );
      console.log(
        `  Files: ${preload.map((f) => `${f.filename} (${f.type})`).join(", ")}`,
      );
    } catch (e) {
      console.log(`  ⚠ Preload: ${e.message}`);
    }

    console.log(`  Importing with emulatorId: ${snesLaunch.launchId}`);
    const { taskId } = await api("POST", "/import/version", {
      id: chronoGameId,
      version: {
        type: version.type,
        identifier: version.identifier,
        name: version.name,
      },
      launches: [
        {
          platform: "Windows",
          name: "Play (Windows)",
          launch: "{rom}",
          emulatorId: snesLaunch.launchId,
        },
      ],
      setups: [],
    });

    await waitForTask(taskId, "Chrono Trigger version import");
  }
}

// ── 7. Final verification ──────────────────────────────────────────────────

console.log("\n=== 7. Verification ===\n");

const { game: finalEmu } = await api("GET", `/game/${snesEmuGameId}`);
const { game: finalRom } = await api("GET", `/game/${chronoGameId}`);

console.log("SNES Windows (Emulator):");
console.log(`  Name: ${finalEmu.mName}`);
console.log(`  Type: ${finalEmu.type}`);
console.log(`  Icon: ${finalEmu.mIconObjectId || "none"}`);
console.log(`  Banner: ${finalEmu.mBannerObjectId || "none"}`);
console.log(`  Versions: ${finalEmu.versions?.length || 0}`);
for (const v of finalEmu.versions || []) {
  console.log(`    Version "${v.displayName || v.versionPath}":`);
  for (const l of v.launches) {
    console.log(`      Launch: ${l.command} (${l.platform})`);
    console.log(`      LaunchId: ${l.launchId}`);
    console.log(`      Suggestions: ${JSON.stringify(l.emulatorSuggestions)}`);
  }
}

console.log(`\nChrono Trigger (ROM):`);
console.log(`  Name: ${finalRom.mName}`);
console.log(`  Type: ${finalRom.type}`);
console.log(`  Icon: ${finalRom.mIconObjectId || "none"}`);
console.log(`  Banner: ${finalRom.mBannerObjectId || "none"}`);
console.log(`  Cover: ${finalRom.mCoverObjectId || "none"}`);
console.log(`  Description: ${finalRom.mShortDescription || "none"}`);
console.log(`  Versions: ${finalRom.versions?.length || 0}`);
for (const v of finalRom.versions || []) {
  console.log(`    Version "${v.displayName || v.versionPath}":`);
  for (const l of v.launches) {
    console.log(`      Launch: ${l.command} (${l.platform})`);
    console.log(`      EmulatorId: ${l.emulatorId || "none"}`);
    if (l.emulator) {
      console.log(
        `      Emulator: ${l.emulator.gameVersion?.game?.mName} → ${l.emulator.gameVersion?.displayName}`,
      );
    }
  }
}

console.log("\n✅ Test complete! Check the admin panel and store to verify.");
console.log("   If metadata/images are correct, run the full import:");
console.log("   node scripts/import-emulation.mjs");
