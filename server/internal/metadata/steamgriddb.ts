import { logger } from "~/server/internal/logging";

const SGDB_BASE = "https://www.steamgriddb.com/api/v2";

interface SGDBGame {
  id: number;
  name: string;
  types: string[];
  verified: boolean;
}

interface SGDBLogo {
  id: number;
  score: number;
  style: string;
  width: number;
  height: number;
  nsfw: boolean;
  humor: boolean;
  url: string;
  thumb: string;
  lock: boolean;
  epilepsy: boolean;
  upvotes: number;
  downvotes: number;
  author: { name: string; steam64: string; avatar: string };
}

export function getSteamGridDBApiKey(): string | null {
  return process.env.STEAMGRIDDB_API_KEY ?? null;
}

async function sgdbFetch<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const res = await fetch(`${SGDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      logger.warn(`SteamGridDB API error: ${res.status} for ${path}`);
      return null;
    }
    const json = await res.json();
    return json.data ?? null;
  } catch (e) {
    logger.warn(`SteamGridDB fetch failed for ${path}: ${e}`);
    return null;
  }
}

export async function sgdbSearchBySteamAppId(
  appId: string,
  apiKey: string,
): Promise<SGDBGame | null> {
  return sgdbFetch<SGDBGame>(`/games/steam/${appId}`, apiKey);
}

export async function sgdbSearchByName(
  name: string,
  apiKey: string,
): Promise<SGDBGame[]> {
  const results = await sgdbFetch<SGDBGame[]>(
    `/search/autocomplete/${encodeURIComponent(name)}`,
    apiKey,
  );
  return results ?? [];
}

export async function sgdbGetLogos(
  gameId: number,
  apiKey: string,
): Promise<SGDBLogo[]> {
  const results = await sgdbFetch<SGDBLogo[]>(
    `/logos/game/${gameId}?styles=official&types=png`,
    apiKey,
  );
  return results ?? [];
}

export async function sgdbGetBestLogoUrl(
  apiKey: string,
  steamAppId?: string,
  gameName?: string,
): Promise<string | null> {
  let sgdbGameId: number | null = null;

  // Try Steam App ID first (most reliable)
  if (steamAppId) {
    const game = await sgdbSearchBySteamAppId(steamAppId, apiKey);
    if (game) sgdbGameId = game.id;
  }

  // Fall back to name search
  if (!sgdbGameId && gameName) {
    const results = await sgdbSearchByName(gameName, apiKey);
    if (results.length > 0) sgdbGameId = results[0].id;
  }

  if (!sgdbGameId) return null;

  // Fetch logos - prefer official style
  const logos = await sgdbGetLogos(sgdbGameId, apiKey);
  if (logos.length === 0) {
    // Try without style filter as fallback
    const allLogos = await sgdbFetch<SGDBLogo[]>(
      `/logos/game/${sgdbGameId}?types=png`,
      apiKey,
    );
    if (!allLogos || allLogos.length === 0) return null;
    // Sort by score descending
    allLogos.sort((a, b) => b.score - a.score);
    return allLogos[0].url;
  }

  // Sort by score descending
  logos.sort((a, b) => b.score - a.score);
  return logos[0].url;
}
