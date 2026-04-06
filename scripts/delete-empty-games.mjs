#!/usr/bin/env node
/**
 * Deletes all games that have no metadata (empty name or folder-name-only).
 * Lists them first, then asks for confirmation before deleting.
 *
 * Usage:  node scripts/delete-empty-games.mjs
 *         node scripts/delete-empty-games.mjs --force   (skip confirmation)
 */

const BASE_URL = "https://drop.canpop.synology.me";
const API_KEY = "0023600a-29d0-4242-9e63-feb867c7c56e";
const FORCE = process.argv.includes("--force");

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method, path) {
  const url = `${BASE_URL}/api/v1/admin${path}`;
  let res;
  try {
    res = await fetch(url, { method, headers });
  } catch (e) {
    console.error(`  [API] Network error: ${e.message}`);
    throw e;
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`  [API] ${method} ${path} → ${res.status}: ${text}`);
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// Fetch all games (returns [{id, mName}])
const allGames = await api("GET", "/game");
console.log(`Total games in database: ${allGames.length}\n`);

// Games with no real metadata typically have mName matching the folder name
// or are empty. List them all so the user can decide.
console.log("All games:");
allGames.forEach((g, i) => {
  console.log(`  ${i + 1}. [${g.id}] ${g.mName}`);
});

// Ask which to delete
console.log("\n---");

if (!FORCE) {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(
    "Enter game numbers to delete (comma-separated), 'all' to delete everything, or 'q' to quit:",
  );
  const answer = await ask("> ");
  rl.close();

  if (answer.trim().toLowerCase() === "q") {
    console.log("Cancelled.");
    process.exit(0);
  }

  let toDelete;
  if (answer.trim().toLowerCase() === "all") {
    toDelete = allGames;
  } else {
    const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1);
    toDelete = indices
      .filter((i) => i >= 0 && i < allGames.length)
      .map((i) => allGames[i]);
  }

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    process.exit(0);
  }

  console.log(`\nDeleting ${toDelete.length} game(s)...`);
  for (const game of toDelete) {
    try {
      await api("DELETE", `/game/${game.id}`);
      console.log(`  Deleted: ${game.mName} (${game.id})`);
    } catch (e) {
      console.log(`  Failed to delete ${game.mName}: ${e.message}`);
    }
  }
} else {
  // --force: delete all
  console.log(`\nForce mode: deleting all ${allGames.length} game(s)...`);
  for (const game of allGames) {
    try {
      await api("DELETE", `/game/${game.id}`);
      console.log(`  Deleted: ${game.mName} (${game.id})`);
    } catch (e) {
      console.log(`  Failed to delete ${game.mName}: ${e.message}`);
    }
  }
}

console.log("\nDone.");
