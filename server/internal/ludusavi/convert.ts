/**
 * Converts a Ludusavi manifest entry into Drop's `savePaths` JSON
 * format that the client-side `cloud_saves` resolver understands.
 *
 * Ludusavi format (per file path):
 *   { "<winAppData>/Company/Game/**": { tags: ["save"], when: [{ os: "windows" }] } }
 *
 * Drop format:
 *   { files: [{ path: "<winAppData>/Company/Game", dataType: "file",
 *               tags: ["save"], conditions: [{ type: "os", value: "windows" }] }] }
 *
 * The placeholder tokens are identical between the two systems.
 */

import type { LudusaviEntry } from ".";

interface DropSavePaths {
  files: DropFileEntry[];
}

interface DropFileEntry {
  path: string;
  dataType: "file" | "registry";
  tags: string[];
  conditions: Array<{ type: string; value: string }>;
}

/**
 * Convert a single Ludusavi game entry to Drop savePaths format.
 * Returns null if the entry has no usable file paths.
 */
export function convertToDropSavePaths(
  _name: string,
  entry: LudusaviEntry,
): DropSavePaths | null {
  const files: DropFileEntry[] = [];

  // Convert file entries
  if (entry.files) {
    for (const [rawPath, meta] of Object.entries(entry.files)) {
      // Strip trailing glob patterns — the resolver recurses directories
      // automatically, so we just need the directory/file path.
      const cleanPath = rawPath
        .replace(/\/\*\*$/, "")
        .replace(/\/\*$/, "")
        .replace(/\*$/, "");

      if (!cleanPath) continue;

      const conditions = buildConditions(meta?.when);
      const tags = meta?.tags ?? ["save"];

      // If no OS condition is specified, emit entries for each platform
      // so the resolver can match on any OS.
      if (conditions.length === 0) {
        files.push({
          path: cleanPath,
          dataType: "file",
          tags,
          conditions: [{ type: "os", value: "windows" }],
        });
        files.push({
          path: cleanPath,
          dataType: "file",
          tags,
          conditions: [{ type: "os", value: "linux" }],
        });
      } else {
        files.push({
          path: cleanPath,
          dataType: "file",
          tags,
          conditions,
        });
      }
    }
  }

  // Convert registry entries (Windows-only)
  if (entry.registry) {
    for (const [regPath, meta] of Object.entries(entry.registry)) {
      const tags = meta?.tags ?? ["save"];
      files.push({
        path: regPath,
        dataType: "registry",
        tags,
        conditions: [{ type: "os", value: "windows" }],
      });
    }
  }

  if (files.length === 0) return null;

  return { files };
}

/**
 * Convert Ludusavi `when` conditions to Drop `conditions` format.
 * Filters out store conditions (we don't use those).
 */
function buildConditions(
  when?: Array<{ os?: string; store?: string }>,
): DropFileEntry["conditions"] {
  if (!when || when.length === 0) return [];

  const conditions: DropFileEntry["conditions"] = [];

  for (const constraint of when) {
    if (constraint.os) {
      // Ludusavi uses "windows", "linux", "mac"
      // Drop uses "windows", "linux", "macos"
      const os = constraint.os === "mac" ? "macos" : constraint.os;
      conditions.push({ type: "os", value: os });
    }
    // We ignore store conditions — Drop doesn't filter by store
  }

  return conditions;
}
