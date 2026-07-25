/*
Talks to the Archipelago WebHost for the bits the client wants to link into.

The client can't fetch the WebHost directly (cross-origin from the Tauri
webview), so the server does it here and hands back a plain list. The only thing
we need is the set of supported game names, scraped from the WebHost's /games
page via its stable per-game options links (`/games/<Name>/player-options`).
That lets the client offer a game search that deep-links straight to the right
options (YAML generator) page instead of the user typing a name that might not
match exactly.

Cached in-memory for an hour; a fetch failure yields an empty list (the client
falls back to free-text search) rather than surfacing an error.
*/

import { systemConfig } from "../config/sys-conf";
import { logger } from "../logging";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 6000;

// Keyed by WebHost URL so changing the configured host invalidates the cache.
let cache: { url: string; games: string[]; fetchedAt: number } | null = null;

/**
 * The Archipelago WebHost's supported-game names. Empty when no WebHost is
 * configured or it can't be reached.
 */
export async function getSupportedGames(): Promise<string[]> {
  const base = systemConfig.getArchipelagoWebHostUrl();
  if (!base) return [];

  if (
    cache &&
    cache.url === base &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.games;
  }

  try {
    const res = await fetch(`${base}/games`, {
      headers: { "user-agent": "Drop" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Every listed game links to `/games/<url-encoded name>/player-options`.
    // Pull the name out of those links — a markup-stable anchor across AP
    // versions — and decode it back to the display name.
    const names = new Set<string>();
    const re = /\/games\/([^/"'\s]+)\/player-options/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        names.add(decodeURIComponent(m[1]));
      } catch {
        // Skip a name that isn't valid percent-encoding.
      }
    }

    const games = Array.from(names).sort((a, b) => a.localeCompare(b));
    cache = { url: base, games, fetchedAt: Date.now() };
    return games;
  } catch (e) {
    logger.warn(
      `[Archipelago] could not fetch supported games from WebHost: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    // Serve a stale-but-usable list if we have one; otherwise nothing.
    return cache?.url === base ? cache.games : [];
  }
}
