/*
HowLongToBeat completion-time enrichment.

HLTB has no public API, so this scrapes the same private search endpoint the
site's own frontend uses. The flow mirrors what the maintained community
clients do, because HLTB rotates the pieces to deter scrapers:

  1. GET the homepage, find the hashed `_app-*.js` bundle.
  2. Pull the bundle and regex out the current search endpoint path
     (`/api/search`, `/api/find`, … — the suffix changes between deploys).
  3. GET `<endpoint>/init?t=<ms>` to obtain a short-lived auth handshake
     (an `x-auth-token` plus a key/value pair whose field *names* also
     rotate — we match them by substring).
  4. POST the search payload with those headers; the key/value pair is also
     injected into the body under its rotating field name.

Every step is best-effort: any failure returns `null` and the import proceeds
without completion times. The resolved endpoint + auth handshake are cached
for a few minutes so a bulk import doesn't re-walk the bundle per game.

This is deliberately NOT an IMetadataProvider — it's a cross-provider
enrichment that runs regardless of which provider resolved the game, since
most games import via Steam, which has no completion-time signal.
*/
import { metadataHttp } from "./http";
import { logger } from "~/server/internal/logging";

const BASE_URL = "https://howlongtobeat.com/";
const PROVIDER = "HowLongToBeat";
// A realistic browser UA — HLTB 403s obvious bot agents.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Short per-request timeout so a slow HLTB can't drag out a bulk import.
const TIMEOUT_MS = 8_000;
// How long a resolved endpoint + auth handshake stays usable before we
// re-walk the bundle. The `/init` token is timestamp-scoped, so keep it short.
const AUTH_TTL_MS = 5 * 60_000;

export interface HltbTimes {
  /** Main Story, in minutes. */
  main: number | null;
  /** Main + Extras, in minutes. */
  mainSides: number | null;
  /** Completionist, in minutes. */
  completionist: number | null;
}

interface HltbAuth {
  endpoint: string; // e.g. "api/search" (no leading slash; BASE_URL ends in /)
  token?: string;
  authKey?: string;
  authValue?: string;
  fetchedAt: number;
}

interface HltbEntry {
  game_name?: string;
  release_world?: number;
  comp_main?: number; // seconds
  comp_plus?: number; // seconds
  comp_100?: number; // seconds
}

let cachedAuth: HltbAuth | null = null;

const headers = () => ({
  "User-Agent": UA,
  Referer: BASE_URL,
  Origin: BASE_URL.replace(/\/$/, ""),
});

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’®™:]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** seconds -> whole minutes, treating HLTB's 0 ("unknown") as null. */
function toMinutes(seconds: number | undefined): number | null {
  return typeof seconds === "number" && seconds > 0
    ? Math.round(seconds / 60)
    : null;
}

/**
 * Walk the homepage -> bundle -> regex to find the current search endpoint
 * path. Returns e.g. "api/search". Returns null if the page shape changed
 * (HLTB redesign) so the caller degrades to no enrichment.
 */
async function resolveEndpoint(): Promise<string | null> {
  let html: string;
  try {
    html = await metadataHttp.fetch<string>(PROVIDER, BASE_URL, {
      method: "GET",
      responseType: "text",
      timeout: TIMEOUT_MS,
      headers: headers(),
    });
  } catch {
    return null;
  }

  // Prefer the app bundle; fall back to every script if HLTB renamed it.
  const allSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map(
    (m) => m[1],
  );
  // Prefer the app bundle, then the rest. Capped so a one-time resolution
  // can't walk an unbounded number of chunks if the page shape shifts — the
  // search fetch currently lives in an early chunk (e.g. the obfuscated
  // `/api/bleed`), and resolution is cached for AUTH_TTL_MS regardless.
  const appFirst = [
    ...allSrcs.filter((s) => s.includes("_app-")),
    ...allSrcs.filter((s) => !s.includes("_app-")),
  ].slice(0, 20);

  // The endpoint lives in a `fetch("/api/<path>...", { method: "POST" ... })`
  // call. The path suffix (search/find/bleed/…) rotates between deploys, so
  // match the POST method rather than a fixed string.
  const endpointRe =
    /fetch\s*\(\s*["']\/api\/([a-zA-Z0-9_/]+)[^"']*["']\s*,\s*\{[^}]*method:\s*["']POST["'][^}]*\}/is;

  for (const src of appFirst) {
    const url = BASE_URL + src.replace(/^\//, "");
    try {
      const js = await metadataHttp.fetch<string>(PROVIDER, url, {
        method: "GET",
        responseType: "text",
        timeout: TIMEOUT_MS,
        headers: headers(),
      });
      const m = endpointRe.exec(js);
      if (m) {
        const base = m[1].split("/")[0]; // "search/v2" -> "search"
        return `api/${base}`;
      }
    } catch {
      // try next script
    }
  }
  return null;
}

/**
 * GET `<endpoint>/init?t=<ms>` for the short-lived auth handshake. HLTB
 * randomizes the key/value field *names*, so match them by substring.
 */
async function resolveAuth(endpoint: string): Promise<HltbAuth> {
  const auth: HltbAuth = { endpoint, fetchedAt: Date.now() };
  try {
    const json = await metadataHttp.fetch<Record<string, unknown>>(
      PROVIDER,
      `${BASE_URL}${endpoint}/init?t=${Date.now()}`,
      { method: "GET", timeout: TIMEOUT_MS, headers: headers() },
    );
    if (json && typeof json === "object") {
      if (typeof json.token === "string") auth.token = json.token;
      for (const [k, v] of Object.entries(json)) {
        if (k === "token") continue;
        if (/key/i.test(k) && typeof v === "string") auth.authKey = v;
        else if (/val/i.test(k) && typeof v === "string") auth.authValue = v;
      }
    }
  } catch {
    // No handshake — the search may still work unauthenticated on some
    // deploys, so we proceed with just the endpoint.
  }
  return auth;
}

async function getAuth(force = false): Promise<HltbAuth | null> {
  if (!force && cachedAuth && Date.now() - cachedAuth.fetchedAt < AUTH_TTL_MS) {
    return cachedAuth;
  }
  const endpoint = await resolveEndpoint();
  if (!endpoint) {
    cachedAuth = null;
    return null;
  }
  cachedAuth = await resolveAuth(endpoint);
  return cachedAuth;
}

function buildPayload(name: string, auth: HltbAuth): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    searchType: "games",
    searchTerms: name.split(/\s+/).filter(Boolean),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: "",
        sortCategory: "popular",
        rangeCategory: "main",
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
        rangeYear: { max: "", min: "" },
        modifier: "",
      },
      users: { sortCategory: "postcount" },
      lists: { sortCategory: "follows" },
      filter: "",
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  };
  // HLTB injects the rotating key/value into the body under the key's name.
  if (auth.authKey && auth.authValue) payload[auth.authKey] = auth.authValue;
  return payload;
}

function pickBest(
  data: HltbEntry[],
  name: string,
  year?: number,
): HltbEntry | null {
  const q = normalize(name);
  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length === 0 || data.length === 0) return null;

  const exact = data.filter((d) => normalize(d.game_name ?? "") === q);
  if (exact.length) {
    if (year) {
      const byYear = exact.find(
        (d) =>
          typeof d.release_world === "number" &&
          Math.abs(d.release_world - year) <= 1,
      );
      if (byYear) return byYear;
    }
    return exact[0];
  }

  // No exact name; only trust the top (popularity-ranked) result if it
  // clearly overlaps the query, so we never attach a wrong game's times.
  const top = data[0];
  const tTokens = new Set(normalize(top.game_name ?? "").split(" "));
  const overlap = qTokens.filter((t) => tTokens.has(t)).length;
  return overlap / qTokens.length >= 0.6 ? top : null;
}

async function searchOnce(
  auth: HltbAuth,
  name: string,
): Promise<HltbEntry[] | null> {
  const reqHeaders: Record<string, string> = {
    ...headers(),
    "content-type": "application/json",
    accept: "*/*",
  };
  if (auth.token) {
    reqHeaders["x-auth-token"] = auth.token;
    if (auth.authKey) reqHeaders["x-hp-key"] = auth.authKey;
    if (auth.authValue) reqHeaders["x-hp-val"] = auth.authValue;
  }
  const res = await metadataHttp.fetch<{ data?: HltbEntry[] }>(
    PROVIDER,
    `${BASE_URL}${auth.endpoint}`,
    {
      method: "POST",
      body: buildPayload(name, auth),
      timeout: TIMEOUT_MS,
      headers: reqHeaders,
    },
  );
  return Array.isArray(res?.data) ? res.data : null;
}

/**
 * Look up HowLongToBeat completion times for a game by name. Best-effort:
 * returns null on any failure or no confident match. `releaseYear` (when
 * known) disambiguates remakes/re-releases sharing a title.
 */
export async function fetchHltbTimes(
  name: string,
  releaseYear?: number,
): Promise<HltbTimes | null> {
  if (!name?.trim()) return null;

  let auth = await getAuth();
  if (!auth) return null;

  let data: HltbEntry[] | null = null;
  try {
    data = await searchOnce(auth, name);
  } catch {
    // A stale handshake reads as a non-2xx; refresh once and retry.
    auth = await getAuth(true);
    if (!auth) return null;
    try {
      data = await searchOnce(auth, name);
    } catch (e) {
      logger.debug(
        `[hltb] search failed for "${name}": ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  if (!data) return null;
  const match = pickBest(data, name, releaseYear);
  if (!match) return null;

  const times: HltbTimes = {
    main: toMinutes(match.comp_main),
    mainSides: toMinutes(match.comp_plus),
    completionist: toMinutes(match.comp_100),
  };
  // Nothing useful matched — treat as a miss rather than storing all-null.
  if (!times.main && !times.mainSides && !times.completionist) return null;
  return times;
}
