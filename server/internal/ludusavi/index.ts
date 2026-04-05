/**
 * Ludusavi manifest integration.
 *
 * The Ludusavi manifest is a community-maintained YAML database
 * (compiled from PCGamingWiki) that maps thousands of PC games to
 * their save file locations.  We download it periodically, parse it
 * into a Postgres table, and use it to auto-populate `savePaths` when
 * a game is imported.
 *
 * Manifest source:
 *   https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml
 *
 * The manifest uses the same placeholder system our cloud_saves
 * resolver already understands (<base>, <winAppData>, <home>, etc.)
 * so no client changes are needed.
 */

import YAML from "yaml";
import prisma from "~/server/internal/db/database";
import { logger } from "~/server/internal/logging";
import { convertToDropSavePaths } from "./convert";

const MANIFEST_URL =
  "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";

// ── Manifest download & import ────────────────────────────────────────────

/** ETag from the last successful download (in-memory cache). */
let lastETag: string | null = null;

/**
 * Download the Ludusavi manifest and upsert every entry into the
 * `LudusaviGame` table.  Uses HTTP ETag caching to avoid re-downloading
 * when nothing changed.
 *
 * Returns the number of games imported, or 0 if the manifest was
 * already up to date.
 */
export async function refreshManifest(
  onProgress?: (pct: number) => void,
): Promise<number> {
  logger.info("[LUDUSAVI] Checking for manifest updates…");

  const headers: Record<string, string> = {};
  if (lastETag) {
    headers["If-None-Match"] = lastETag;
  }

  const res = await fetch(MANIFEST_URL, { headers });

  if (res.status === 304) {
    logger.info("[LUDUSAVI] Manifest unchanged (304).");
    return 0;
  }

  if (!res.ok) {
    throw new Error(
      `[LUDUSAVI] Manifest download failed: ${res.status} ${res.statusText}`,
    );
  }

  const etag = res.headers.get("etag");
  const text = await res.text();

  logger.info(
    `[LUDUSAVI] Downloaded manifest (${(text.length / 1024 / 1024).toFixed(1)} MB), parsing…`,
  );

  onProgress?.(10);

  // Parse the full YAML.  The top-level keys are game names.
  const manifest: Record<string, LudusaviEntry> = YAML.parse(text);
  const entries = Object.entries(manifest);
  const total = entries.length;

  logger.info(`[LUDUSAVI] Parsed ${total} games, importing…`);
  onProgress?.(30);

  // Batch upsert in chunks to avoid overwhelming the DB.
  const BATCH = 500;
  let imported = 0;

  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const ops = chunk
      .map(([name, entry]) => {
        const savePaths = convertToDropSavePaths(name, entry);
        if (!savePaths) return null; // No usable file paths

        const steamId = entry.steam?.id ?? null;
        const gogId = entry.gog?.id ?? null;
        const savePathsJson = JSON.stringify(savePaths);

        return prisma.ludusaviGame.upsert({
          where: { name },
          create: { name, steamId, gogId, savePaths: savePathsJson },
          update: { steamId, gogId, savePaths: savePathsJson },
        });
      })
      .filter(Boolean);

    if (ops.length > 0) {
      await prisma.$transaction(ops as any[]);
    }

    imported += ops.length;

    const pct = 30 + Math.round(((i + chunk.length) / total) * 70);
    onProgress?.(Math.min(pct, 100));
  }

  lastETag = etag;
  logger.info(`[LUDUSAVI] Imported ${imported}/${total} games.`);
  return imported;
}

// ── Lookup ────────────────────────────────────────────────────────────────

/**
 * Look up a game's save paths from the Ludusavi manifest.
 *
 * Tries matching in this order:
 *   1. Steam AppID (exact match — most reliable)
 *   2. Game name (trigram similarity search)
 *
 * Returns the pre-converted Drop `savePaths` JSON string, or null if
 * no match was found.
 */
export async function lookupSavePaths(
  steamAppId?: string | null,
  gameName?: string | null,
): Promise<string | null> {
  // 1. Try by Steam AppID
  if (steamAppId) {
    const id = parseInt(steamAppId, 10);
    if (Number.isFinite(id)) {
      const match = await prisma.ludusaviGame.findFirst({
        where: { steamId: id },
      });
      if (match) {
        logger.info(`[LUDUSAVI] Matched "${match.name}" by Steam AppID ${id}`);
        return match.savePaths;
      }
    }
  }

  // 2. Try by name similarity
  if (gameName) {
    // Use Postgres trigram similarity for fuzzy matching.
    // The GiST index on name makes this efficient.
    const matches = await prisma.$queryRaw<
      { name: string; savePaths: string; similarity: number }[]
    >`
      SELECT name, "savePaths", similarity(name, ${gameName}) AS similarity
      FROM "LudusaviGame"
      WHERE similarity(name, ${gameName}) > 0.3
      ORDER BY similarity DESC
      LIMIT 1
    `;

    if (matches.length > 0) {
      logger.info(
        `[LUDUSAVI] Matched "${matches[0].name}" by name (similarity ${matches[0].similarity.toFixed(2)}) for "${gameName}"`,
      );
      return matches[0].savePaths;
    }
  }

  return null;
}

// ── Types (matching Ludusavi manifest YAML structure) ─────────────────────

export interface LudusaviEntry {
  files?: Record<
    string,
    {
      tags?: string[];
      when?: Array<{ os?: string; store?: string }>;
    }
  >;
  registry?: Record<
    string,
    {
      tags?: string[];
      when?: Array<{ store?: string }>;
    }
  >;
  installDir?: Record<string, Record<string, never>>;
  steam?: { id?: number };
  gog?: { id?: number };
  id?: {
    flatpak?: string;
    gogExtra?: number[];
    lutris?: string;
    steamExtra?: number[];
  };
}
