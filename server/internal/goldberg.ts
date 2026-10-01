import fs from "fs";
import path from "path";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { logger as defaultLogger } from "~/server/internal/logging";

/**
 * Logger surface accepted by setupGoldberg. We deliberately keep this
 * loose so a pino instance, a task-context logger, or a plain test
 * shim can all be passed in — the swap path emits via this so that
 * version-import progress is visible to the admin running the import.
 */
export type GoldbergLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

/**
 * Goldberg Steam Emulator achievement utilities.
 *
 * DRM-free games use the Goldberg emulator to provide Steam-like achievement
 * support. Achievement *definitions* live next to the game files:
 *   <versionDir>/steam_settings/achievements.json
 *
 * The Steam AppID is stored in:
 *   <versionDir>/steam_settings/steam_appid.txt
 *
 * On a player's machine the *unlock state* is saved by the emulator.
 * Drop configures Goldberg to use a controlled save directory by writing
 * `local_save_path=./drop-goldberg` into the game's `steam_settings/configs.user.ini`.
 * This makes unlocks land at:
 *   <install_dir>/drop-goldberg/<AppID>/achievements.json
 *
 * The client also checks fallback paths in AppData for common Goldberg forks
 * (GSE Saves, Goldberg SteamEmu Saves) in case the game was launched
 * outside of Drop.
 *
 * Each entry gains `earned` (boolean) and `earned_time` (unix timestamp)
 * fields once the player unlocks it in-game.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Steam's GetSchemaForGame/v2 can return localised fields as either a plain
 * string or an object keyed by language, e.g.
 *   { english: "BONExYARD", german: "KNOCHENxGRUBE", french: "NÉCROxPOLE" }
 *
 * This helper always returns a plain string.
 */
function resolveLocalised(
  value: string | Record<string, string> | undefined,
  fallback: string = "",
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.english ?? value.token ?? Object.values(value)[0] ?? fallback;
  }
  return fallback;
}

/**
 * Resolves a Goldberg achievement icon reference to a loadable URL.
 *
 * Steam's GetSchemaForGame returns `icon` as a full https:// URL, but a
 * crack's local achievements.json stores only the emulator-relative path
 * (e.g. `img/<hash>.jpg`), which 404s on any web server. For that local
 * case we strip the directory prefix and rebuild the public Steam CDN URL
 * (same base + path shape used for game icons in metadata/steam.ts). A
 * fake / local-only AppID will still 404 there — the UI falls back to a
 * trophy glyph in that case.
 */
function resolveGoldbergIcon(icon: string | undefined, appId: string): string {
  if (!icon) return "";
  if (/^https?:\/\//.test(icon)) return icon;
  const file = icon.replace(/^.*[\\/]/, "");
  return `https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/${appId}/${file}`;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface GoldbergAchievementDef {
  /** Steam-style API name, e.g. "ACH_WIN_ONE_GAME" */
  name: string;
  /**
   * Display name and description. GBE's local `achievements.json` stores these
   * as EITHER a plain string OR a localised object ({english, german, ...,
   * token}) — the Steam API can too. Always run through `resolveLocalised`
   * before writing to the DB, which requires a plain string.
   */
  displayName?: string | Record<string, string>;
  description?: string | Record<string, string>;
  icon?: string;
  icon_gray?: string;
  hidden?: number;
  /** Global unlock rarity % from Steam's official global-percentages API. */
  globalPercent?: number | null;
}

export interface GoldbergAchievementUnlock extends GoldbergAchievementDef {
  earned?: boolean;
  earned_time?: number;
}

// ── Filesystem helpers (server-side, reads from NAS) ────────────────────────

/**
 * Resolves the on-disk path of the newest version of a game.
 * Returns undefined when the game/library is not filesystem-backed.
 */
export async function resolveGameVersionDir(
  gameId: string,
): Promise<string | undefined> {
  return (await resolveGameVersion(gameId))?.versionDir;
}

/**
 * The newest version of a game that has files on disk: its directory and its
 * versionId. Pass the versionId to `setupGoldberg` so a manifest regeneration
 * targets the version whose files were actually changed (the newest version
 * overall may have no directory, e.g. a depot version).
 */
export async function resolveGameVersion(
  gameId: string,
): Promise<{ versionDir: string; versionId: string } | undefined> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      libraryPath: true,
      library: { select: { backend: true, options: true } },
      versions: {
        where: { versionPath: { not: null } },
        orderBy: { versionIndex: "desc" },
        take: 1,
        select: { versionPath: true, versionId: true },
      },
    },
  });

  if (!game || game.versions.length === 0) {
    defaultLogger.warn(
      `[PHASE:emulator] resolveGameVersionDir: no game or no versions for ${gameId}`,
    );
    return undefined;
  }

  const backend = game.library.backend;
  if (backend !== "Filesystem" && backend !== "FlatFilesystem") {
    defaultLogger.warn(
      `[PHASE:emulator] resolveGameVersionDir: unsupported backend "${backend}"`,
    );
    return undefined;
  }

  const options = game.library.options as { baseDir?: string };
  if (!options.baseDir) {
    defaultLogger.warn(
      `[PHASE:emulator] resolveGameVersionDir: no baseDir in library options`,
    );
    return undefined;
  }

  const versionPath = game.versions[0].versionPath!;
  const versionId = game.versions[0].versionId;

  if (backend === "FlatFilesystem") {
    const resolved = path.join(options.baseDir, game.libraryPath);
    defaultLogger.info(
      `[PHASE:emulator] resolveGameVersionDir: FlatFilesystem => ${resolved}`,
    );
    return { versionDir: resolved, versionId };
  }

  const resolved = path.join(options.baseDir, game.libraryPath, versionPath);
  defaultLogger.info(
    `[PHASE:emulator] resolveGameVersionDir: Filesystem => baseDir="${options.baseDir}" libraryPath="${game.libraryPath}" versionPath="${versionPath}" => ${resolved}`,
  );
  return { versionDir: resolved, versionId };
}

/**
 * Reads the Goldberg achievement definition file from a game's directory.
 * Returns an empty array if the file doesn't exist.
 *
 * Volatile fields (`globalPercent`) are dropped on read: files written by
 * older builds carry a Steam rarity snapshot from whenever they were written,
 * and reading it back would overwrite the fresher value in the DB on every
 * scan. See VOLATILE_DEFINITION_FIELDS.
 */
export function readGoldbergDefinitions(
  versionDir: string,
): GoldbergAchievementDef[] {
  const filePath = path.join(versionDir, "steam_settings", "achievements.json");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return stripVolatile(data) as GoldbergAchievementDef[];
  } catch {
    return [];
  }
}

/**
 * Reads the Steam AppID from a game's steam_settings directory.
 */
export function readGoldbergAppId(versionDir: string): string | undefined {
  const filePath = path.join(versionDir, "steam_settings", "steam_appid.txt");
  if (!fs.existsSync(filePath)) return undefined;

  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return undefined;
  }
}

// ── Steam API fetcher ──────────────────────────────────────────────────────

/**
 * Fetches achievement definitions from Steam's Web API.
 * Requires STEAM_API_KEY env var (free from https://steamcommunity.com/dev/apikey).
 *
 * Returns definitions in our standard format, or an empty array on failure.
 */
export async function fetchSteamAchievements(
  appId: string,
): Promise<GoldbergAchievementDef[]> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    defaultLogger.warn(
      `[PHASE:emulator] STEAM_API_KEY not set, cannot fetch achievements for AppID ${appId}`,
    );
    return [];
  }

  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}`;
  defaultLogger.info(
    `[PHASE:emulator] Fetching achievements from Steam API for AppID ${appId}`,
  );

  try {
    const res = await fetch(url);
    if (!res.ok) {
      defaultLogger.warn(
        `[PHASE:emulator] Steam API returned ${res.status} for AppID ${appId}`,
      );
      return [];
    }

    const json = (await res.json()) as {
      game?: {
        availableGameStats?: {
          achievements?: {
            name: string;
            displayName?: string | Record<string, string>;
            description?: string | Record<string, string>;
            icon?: string;
            icongray?: string;
            hidden?: number;
          }[];
        };
      };
    };

    const achievements = json.game?.availableGameStats?.achievements;
    if (!achievements || achievements.length === 0) {
      defaultLogger.info(
        `[PHASE:emulator] No achievements in Steam API response for AppID ${appId}`,
      );
      return [];
    }

    defaultLogger.info(
      `[PHASE:emulator] Got ${achievements.length} achievements from Steam API for AppID ${appId}`,
    );

    // Global unlock rarity (best-effort; empty map on failure).
    const percentMap = await fetchSteamGlobalPercentages(appId);

    return achievements.map((a) => ({
      name: a.name,
      displayName: resolveLocalised(a.displayName, a.name),
      description: resolveLocalised(a.description, ""),
      icon: a.icon,
      icon_gray: a.icongray,
      hidden: a.hidden,
      globalPercent: percentMap.get(a.name) ?? null,
    }));
  } catch (e) {
    defaultLogger.warn(
      `[PHASE:emulator] Steam API fetch failed for AppID ${appId}: ${e}`,
    );
    return [];
  }
}

/**
 * Global unlock rarity per achievement, from Steam's official, no-key
 * global-percentages endpoint — the same data behind the "X% of players"
 * figures on the Steam store. Returns name -> percent; an empty map on any
 * failure (rarity is best-effort and must never block achievement setup).
 */
async function fetchSteamGlobalPercentages(
  appId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const json = (await res.json()) as {
      achievementpercentages?: {
        achievements?: { name: string; percent: number }[];
      };
    };
    for (const a of json.achievementpercentages?.achievements ?? []) {
      if (typeof a.percent === "number") map.set(a.name, a.percent);
    }
  } catch (e) {
    defaultLogger.warn(
      `[PHASE:emulator] Steam global-percentages fetch failed for AppID ${appId}: ${e}`,
    );
  }
  return map;
}

// ── Local ↔ Steam definition merge ─────────────────────────────────────────

/**
 * True when a (possibly localised) field carries usable text.
 * `{ english: "" }` and `"   "` both count as empty.
 */
function hasText(value: string | Record<string, string> | undefined): boolean {
  return resolveLocalised(value, "").trim().length > 0;
}

/**
 * Per-field gap counts for a set of definitions.
 *
 * Text and icons only. `globalPercent` is deliberately NOT tracked here — see
 * the note on `mergeSteamIntoLocal`.
 */
export type DefinitionGaps = {
  displayName: number;
  description: number;
  icon: number;
};

/**
 * Counts what a local `achievements.json` is missing.
 *
 * A crack's shipped schema is frequently name + icon only, or name +
 * displayName only. Those entries are still valid GBE unlock keys, but they
 * give the player nothing to read, which is why Drop showed bare titles where
 * Steam shows "Complete Chapter 1."
 *
 * `hidden` entries are deliberately exempt from the description check: a
 * hidden achievement is *supposed* to have no description until it unlocks,
 * and Steam returns an empty one for them too. Counting those as a gap would
 * make every future scan call Steam forever for a hole Steam cannot fill.
 */
export function countDefinitionGaps(
  defs: GoldbergAchievementDef[],
): DefinitionGaps {
  const gaps: DefinitionGaps = {
    displayName: 0,
    description: 0,
    icon: 0,
  };
  for (const def of defs) {
    if (!hasText(def.displayName)) gaps.displayName++;
    if (!hasText(def.description) && !def.hidden) gaps.description++;
    if (!def.icon?.trim()) gaps.icon++;
  }
  return gaps;
}

/** True when at least one definition has a gap Steam could plausibly fill. */
export function needsSteamEnrichment(defs: GoldbergAchievementDef[]): boolean {
  const gaps = countDefinitionGaps(defs);
  return gaps.displayName > 0 || gaps.description > 0 || gaps.icon > 0;
}

export type DefinitionMergeResult = {
  definitions: GoldbergAchievementDef[];
  /** How many entries each field was filled in for. */
  filled: DefinitionGaps;
  /** Steam names with no local counterpart. Reported, never added — see below. */
  steamOnly: string[];
};

/**
 * Fills the gaps in a local GBE schema from Steam's, matched on `name`.
 *
 * Two authorities, split by what each one actually knows:
 *
 *   - The LOCAL file decides WHICH achievements exist and in what order.
 *     `name` is the key the game passes to `SetAchievement()`, so an entry
 *     the crack never shipped can never fire. This is why Steam-only names
 *     are counted and logged but NOT added: they would be permanently
 *     unearnable rows that cap every player's completion below 100%.
 *   - STEAM is the authority for the human-readable text a crack's schema
 *     does not reliably carry: title, description, icon.
 *
 * Every field is filled only when the local value is empty AND Steam's is
 * not. Steam legitimately returns an empty description for `hidden: 1`
 * achievements, so a blind overwrite would erase real text the crack shipped.
 *
 * `globalPercent` is NOT merged, on purpose. Drop reports rarity across its
 * OWN player base (`unlocks / ownerCount`, computed in
 * `achievements/gameDetail.ts`), and the client prefers a stored
 * `globalPercent` over that figure when one exists. Copying Steam's global
 * percentage in here would silently reinterpret every "% of players" label on
 * these games from "of Drop's players" to "of Steam's". That is a product
 * decision, not a side effect of repairing missing descriptions, so this
 * function leaves the field exactly as the local file had it.
 *
 * Local icons are kept when present: they are emulator-relative paths
 * (`img/<hash>.jpg`) that GBE's in-game overlay loads off disk, and
 * `resolveGoldbergIcon` already rebuilds a CDN URL from them for the DB.
 * Replacing them with Steam's https URL would break the overlay.
 *
 * Pure — no I/O, no DB, no clock. The one piece of logic here worth testing;
 * drop-server has no test runner, so it is exported and untested.
 */
export function mergeSteamIntoLocal(
  local: GoldbergAchievementDef[],
  steam: GoldbergAchievementDef[],
): DefinitionMergeResult {
  const bySteamName = new Map<string, GoldbergAchievementDef>();
  for (const s of steam) {
    if (s.name) bySteamName.set(s.name, s);
  }

  const filled: DefinitionGaps = {
    displayName: 0,
    description: 0,
    icon: 0,
  };
  const matched = new Set<string>();

  const definitions = local.map((def) => {
    const remote = def.name ? bySteamName.get(def.name) : undefined;
    if (!remote) return def;
    matched.add(def.name);

    const merged: GoldbergAchievementDef = { ...def };

    if (!hasText(merged.displayName) && hasText(remote.displayName)) {
      merged.displayName = remote.displayName;
      filled.displayName++;
    }
    if (!hasText(merged.description) && hasText(remote.description)) {
      merged.description = remote.description;
      filled.description++;
    }
    if (!merged.icon?.trim() && remote.icon?.trim()) {
      merged.icon = remote.icon;
      filled.icon++;
    }
    if (!merged.icon_gray?.trim() && remote.icon_gray?.trim()) {
      merged.icon_gray = remote.icon_gray;
    }
    // Carries the "no description by design" flag across, so the next scan
    // stops treating this entry's blank description as a fillable gap. Note
    // that GBE reads this field too: an entry the crack shipped without it
    // (GBE default 0, visible) that Steam marks hidden will also become
    // hidden in the in-game overlay, which matches how the real game behaves.
    if (merged.hidden === undefined && typeof remote.hidden === "number") {
      merged.hidden = remote.hidden;
    }
    // `globalPercent` is intentionally not copied across. See above.

    return merged;
  });

  return {
    definitions,
    filled,
    steamOnly: [...bySteamName.keys()].filter((name) => !matched.has(name)),
  };
}

// ── steam_settings/achievements.json contents ─────────────────────────────

/**
 * Fields left out of the achievements.json written into the game files.
 *
 * `globalPercent` is Steam's global unlock rarity. It changes daily, and
 * nothing reads it from this file: GBE ignores unknown fields, the desktop
 * client gets rarity from the server, and `readGoldbergDefinitions` drops it
 * so the DB keeps its stored value (`upsertDefinitions` falls back to the
 * previous one). Writing it would make every definition refresh rewrite every
 * game's file and regenerate every manifest.
 */
const VOLATILE_DEFINITION_FIELDS = ["globalPercent"] as const;

function stripVolatile(defs: unknown[]): unknown[] {
  const volatile = new Set<string>(VOLATILE_DEFINITION_FIELDS);
  return defs.map((d) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) return d;
    return Object.fromEntries(
      Object.entries(d as Record<string, unknown>).filter(
        ([key]) => !volatile.has(key),
      ),
    );
  });
}

/** The exact text written to steam_settings/achievements.json. */
export function serialiseDefinitionsFile(
  defs: GoldbergAchievementDef[],
): string {
  return JSON.stringify(stripVolatile(defs), null, 2);
}

/**
 * True when the file on disk already holds these definitions, ignoring the
 * volatile fields. Files written by older builds still carry `globalPercent`;
 * they compare equal here, so they aren't rewritten just to drop it.
 *
 * Pure. drop-server has no test runner, so this is exported and untested.
 */
export function sameDefinitionsFile(
  existing: string | null,
  serialised: string,
): boolean {
  if (existing === null) return false;
  if (existing === serialised) return true;
  try {
    const parsed: unknown = JSON.parse(existing);
    if (!Array.isArray(parsed)) return false;
    return JSON.stringify(stripVolatile(parsed), null, 2) === serialised;
  } catch {
    return false;
  }
}

// ── Post-import achievement setup ──────────────────────────────────────────

/**
 * Called after a game version is imported. Sets up everything Goldberg
 * needs to function:
 *
 * 1. Reads `steam_appid.txt` to get the AppID
 * 2. Reads local `achievements.json` — if missing, fetches from Steam's
 *    public API and writes it to disk for the emulator
 * 3. Swaps the bundled `steam_api[64].dll` for a GBE build if it isn't
 *    one already — without this the game calls Valve's real Steamworks,
 *    fails to reach a Steam pipe, and exits on launch. Original DLL is
 *    preserved as `<dll>.steam_backup`.
 * 4. Creates/updates the `GameExternalLink` (Goldberg ↔ AppID)
 * 5. Upserts all `Achievement` definition records in the DB
 * 6. When it changed anything on disk (steam_settings/ created, steam_appid.txt
 *    or achievements.json written, a stale steam_settings/ removed, a DLL
 *    swapped), regenerates the droplet manifest of `options.versionId` (the
 *    version this directory belongs to), so clients get the new files and
 *    don't fail checksum validation. `options.manifest` says how:
 *      - "now" (default): hash here; for admin tasks, which are already
 *        background work.
 *      - "queue": start a background task and return; for HTTP requests
 *        (the admin achievement scan).
 *      - "skip": the import phase. Its own manifest phase runs afterwards
 *        over the post-setup bytes, and the version being imported isn't
 *        in the DB yet.
 *    Without a versionId nothing is regenerated and a warning says to run
 *    "Regenerate Manifests".
 *
 * Failures are logged but never thrown — Goldberg setup should never
 * block a version import.
 */
export async function setupGoldberg(
  gameId: string,
  versionDir: string,
  options?: {
    forceRefreshAchievements?: boolean;
    /**
     * When true (the import phase), replace eligible steam_api DLLs with the
     * bundled GBE build. The achievement-refresh / readiness tasks leave this
     * false so they never touch binaries.
     */
    swapDll?: boolean;
    /**
     * Logger that receives every status message. Defaults to the global
     * server logger; pass the task-context logger when running inside an
     * admin task so the swap progress shows up in the live task log.
     */
    logger?: GoldbergLogger;
    /** How to regenerate the manifest after changing files (step 6). */
    manifest?: "now" | "queue" | "skip";
    /** The GameVersion that `versionDir` belongs to (step 6). */
    versionId?: string;
  },
): Promise<{
  dllsSwapped: number;
  definitionsFileChanged: boolean;
  /** Anything under the version directory was created, written or removed. */
  filesChanged: boolean;
  /** The manifest was regenerated by this call. */
  manifestRegenerated: boolean;
}> {
  const log: GoldbergLogger = options?.logger ?? {
    info: (msg) => defaultLogger.info(msg),
    warn: (msg) => defaultLogger.warn(msg),
  };
  let dllsSwapped = 0;
  let fileChanged = false;
  // Any write/removal under versionDir, not just achievements.json.
  let diskChanged = false;
  let manifestRegenerated = false;
  const result = () => ({
    dllsSwapped,
    definitionsFileChanged: fileChanged,
    filesChanged: diskChanged || fileChanged || dllsSwapped > 0,
    manifestRegenerated,
  });

  try {
    // Resolve the actual directory containing the Steam API DLL.
    // GBE expects steam_settings/ next to the DLL, which may be in a
    // subdirectory (e.g. GameData/Plugins/x86_64/), not the version root.
    const { findSteamApiDll } = await import("./gbe");
    const dllInfo = findSteamApiDll(versionDir);
    const settingsRoot = dllInfo ? dllInfo.dllDir : versionDir;

    // ── Cleanup: remove stale steam_settings/ at version root ───────────
    // If the DLL lives in a subdirectory, any steam_settings/ at the
    // version root is leftover from an older approach and unused by GBE.
    if (settingsRoot !== versionDir) {
      const staleSettings = path.join(versionDir, "steam_settings");
      if (fs.existsSync(staleSettings)) {
        fs.rmSync(staleSettings, { recursive: true, force: true });
        diskChanged = true;
        log.info(
          `[GOLDBERG] Removed stale steam_settings/ at version root (DLL is in ${settingsRoot})`,
        );
      }
    }

    // ── 0. Look up the per-game / per-library swap policy up-front ──────
    // We need this BEFORE the swap step so we can short-circuit cleanly
    // when an admin has opted the game (or its library) out of auto-swap.
    const gameRow = await prisma.game.findUnique({
      where: { id: gameId },
      select: {
        metadataSource: true,
        metadataId: true,
      },
    });

    // ── 1. Resolve the AppID ─────────────────────────────────────────────
    // Try the local file first, then fall back to an existing DB link.
    let appId =
      readGoldbergAppId(settingsRoot) || readGoldbergAppId(versionDir);

    if (!appId) {
      const existingLink = await prisma.gameExternalLink.findUnique({
        where: {
          gameId_provider: {
            gameId,
            provider: ExternalAccountProvider.Goldberg,
          },
        },
      });
      if (existingLink) {
        appId = existingLink.externalGameId;
        log.info(`[GOLDBERG] No steam_appid.txt, using DB link AppID ${appId}`);
      }
    }

    // Fall back to the game's metadata — if it was imported from Steam,
    // metadataId IS the Steam AppID.
    if (!appId) {
      if (gameRow?.metadataSource === "Steam" && gameRow.metadataId) {
        appId = gameRow.metadataId;
        log.info(
          `[GOLDBERG] No steam_appid.txt or DB link, using Steam metadata AppID ${appId}`,
        );
      }
    }

    if (!appId) {
      log.info(`[GOLDBERG] No AppID for ${versionDir}, skipping`);
      await maybeRegenerate();
      return result();
    }

    log.info(
      `[GOLDBERG] Setting up game=${gameId} appId=${appId} dir=${settingsRoot}`,
    );

    // ── 2. Ensure steam_settings/ and steam_appid.txt exist on disk ──────
    const steamSettings = path.join(settingsRoot, "steam_settings");
    if (!fs.existsSync(steamSettings)) {
      fs.mkdirSync(steamSettings, { recursive: true });
      diskChanged = true;
      log.info(`[GOLDBERG] Created ${steamSettings}`);
    }

    const appIdPath = path.join(steamSettings, "steam_appid.txt");
    if (!fs.existsSync(appIdPath)) {
      fs.writeFileSync(appIdPath, appId, "utf-8");
      diskChanged = true;
      log.info(`[GOLDBERG] Wrote steam_appid.txt (${appId})`);
    }

    // ── 2b. steam_api DLL swap (Plan B: GBE everywhere) ──────────────────
    // Replace eligible steam_api DLLs with the bundled GBE build so the game
    // gets achievements + Goldberg LAN/ZeroTier matchmaking. Runs only when the
    // caller asks (import phase); the refresh/readiness tasks pass swapDll=false
    // so they never touch binaries. Anti-cheat (EAC/BattlEye) games are skipped
    // (Goldberg can't satisfy them). Loader cracks (OnlineFix/Cream) are also
    // left in place for now: removing them safely means stripping the proxy
    // loader DLL too (winmm/dnet/version/…), which needs per-crack detection +
    // Steam Deck verification — the dedicated OnlineFix-removal step. The swap
    // happens BEFORE the manifest phase so the GBE bytes land in the manifest.
    //
    // The runtime save dir (drop-goldberg/<AppID>/) is intentionally NOT created
    // here — it's a client-side artifact; creating it (or seeding a save file)
    // inside versionDir would hash it into the manifest and ship an all-zero
    // save to every client, clobbering real progress on update. The client/GBE
    // creates + owns it at launch (under the DLL-anchored drop-goldberg/, which
    // PROTECTED_DATA_DIRS shields from the reconcile sweep).
    if (options?.swapDll) {
      const {
        detectAntiCheat,
        detectCrackLoader,
        findAllSteamApiDlls,
        ensureGbeDll,
      } = await import("./gbe");

      const antiCheat = detectAntiCheat(versionDir);
      const loader = detectCrackLoader(versionDir);
      if (antiCheat) {
        log.info(
          `[GBE] Anti-cheat present (${antiCheat}) — Goldberg can't satisfy it; ` +
            `leaving steam_api DLL(s) untouched.`,
        );
      } else if (loader) {
        log.info(
          `[GBE] Loader crack present (${loader}) — leaving it in place ` +
            `(OnlineFix removal is a separate, Deck-verified step).`,
        );
      } else {
        const dlls = findAllSteamApiDlls(versionDir);
        if (dlls.length === 0) {
          log.info(
            `[GBE] No steam_api DLL under ${versionDir} — nothing to swap.`,
          );
        } else if (dlls.length > 1) {
          log.info(
            `[GBE] ${dlls.length} steam_api DLLs found (multi-arch) — swapping each.`,
          );
        }
        for (const { dllDir, dllName } of dlls) {
          const res = ensureGbeDll(dllDir, dllName, appId, log);
          if (res.swapped) {
            dllsSwapped++;
          } else if (res.skipped && !res.alreadyGbe) {
            log.info(
              `[GBE] Left ${dllName} alone: ` +
                `${res.reason ?? res.identification?.fingerprint ?? "ineligible"}`,
            );
          }
        }
      }
    }

    // ── 3. Fetch/read achievement definitions ────────────────────────────
    // The local file and Steam each know something the other doesn't, so we
    // merge rather than pick a winner. See `mergeSteamIntoLocal`. Before this,
    // a non-empty local file short-circuited Steam entirely, which is why a
    // crack that shipped name + icon only produced achievements that showed a
    // title and nothing else anywhere in Drop.
    const forceRefresh = options?.forceRefreshAchievements ?? false;
    let definitions = forceRefresh ? [] : readGoldbergDefinitions(settingsRoot);

    if (definitions.length === 0) {
      log.info(
        forceRefresh
          ? `[GOLDBERG] Force-refreshing achievements from Steam API`
          : `[GOLDBERG] No local achievements.json, fetching from Steam API`,
      );
      definitions = await fetchSteamAchievements(appId);
    } else if (needsSteamEnrichment(definitions)) {
      const gaps = countDefinitionGaps(definitions);
      log.info(
        `[GOLDBERG] Local achievements.json has gaps across ${definitions.length} entries ` +
          `(${gaps.description} without a description, ${gaps.displayName} without a title, ` +
          `${gaps.icon} without an icon) — filling from Steam`,
      );

      const steamDefs = await fetchSteamAchievements(appId);
      if (steamDefs.length === 0) {
        // Network down, rate limited, no API key, or a fake AppID. The local
        // definitions still unlock correctly, so keep them exactly as they
        // are — an outage must never cost the player working achievements.
        log.warn(
          `[GOLDBERG] Steam returned nothing for AppID ${appId} — keeping the ` +
            `${definitions.length} local definition(s) unchanged`,
        );
      } else {
        const merged = mergeSteamIntoLocal(definitions, steamDefs);
        definitions = merged.definitions;
        log.info(
          `[GOLDBERG] Filled ${merged.filled.description} description(s), ` +
            `${merged.filled.displayName} title(s) and ${merged.filled.icon} icon(s) from Steam`,
        );
        if (merged.steamOnly.length > 0) {
          // Not added on purpose: the emulator can only ever unlock names the
          // crack shipped, so these would be permanently unearnable rows that
          // hold every player's completion below 100%.
          log.info(
            `[GOLDBERG] ${merged.steamOnly.length} achievement(s) exist on Steam but not in ` +
              `this build's schema and were left out (${merged.steamOnly.slice(0, 5).join(", ")}` +
              `${merged.steamOnly.length > 5 ? ", …" : ""})`,
          );
        }
      }
    } else {
      log.info(
        `[GOLDBERG] Local achievements.json is complete (${definitions.length} entries) — not calling Steam`,
      );
    }

    // Write definitions to steam_settings/achievements.json (the GBE achievement
    // SCHEMA, array format). The runtime unlock-state file
    // (drop-goldberg/<AppID>/achievements.json) is deliberately NOT written
    // here: it's a client-side save artifact, and writing it inside versionDir
    // would hash it into the manifest and ship an all-zero save to every client,
    // clobbering real progress on update. The client/GBE creates + owns it at
    // launch under the DLL-anchored drop-goldberg/, which PROTECTED_DATA_DIRS
    // shields from the reconcile sweep.
    //
    // The shape written is exactly the shape `readGoldbergDefinitions` reads
    // back — a flat array of the same objects the local file already held,
    // with empty text fields filled in — so a merged file survives the next
    // scan and the in-game GBE overlay picks up the better text too. That
    // persistence is what stops the next scan from calling Steam again.
    if (definitions.length > 0) {
      const settingsAchPath = path.join(steamSettings, "achievements.json");
      const serialised = serialiseDefinitionsFile(definitions);
      const existing = fs.existsSync(settingsAchPath)
        ? fs.readFileSync(settingsAchPath, "utf-8")
        : null;
      // Only write when the definitions actually differ. This file sits inside
      // the version directory, so a rewrite changes its hash, regenerates the
      // manifest and makes every installed copy stale — worth doing when we
      // have better text to store, never for identical content. Compared with
      // volatile fields removed (see serialiseDefinitionsFile), so Steam's
      // daily-moving rarity figures can't force a rewrite of every game.
      if (!sameDefinitionsFile(existing, serialised)) {
        fs.writeFileSync(settingsAchPath, serialised, "utf-8");
        fileChanged = true;
        log.info(
          `[GOLDBERG] Wrote ${definitions.length} achievement definitions to steam_settings/`,
        );
      }
    }

    // ── 4. Create/update the DB external link ────────────────────────────
    await prisma.gameExternalLink.upsert({
      where: {
        gameId_provider: {
          gameId,
          provider: ExternalAccountProvider.Goldberg,
        },
      },
      create: {
        gameId,
        provider: ExternalAccountProvider.Goldberg,
        externalGameId: appId,
      },
      update: {
        externalGameId: appId,
      },
    });

    // ── 5. Upsert achievement definitions in DB ──────────────────────────
    // Goes through the canonical achievementsRepo.upsertDefinitions so
    // the DB write path is identical to the RA scanner and the admin
    // scan orchestrator (see server/internal/achievements/repo.ts and
    // docs/audit/achievements-2026.md). Imported lazily to avoid a
    // circular import — the achievements module imports setupGoldberg.
    let count = 0;
    if (definitions.length === 0) {
      log.info(`[GOLDBERG] No achievements found for AppID ${appId}`);
    } else {
      const { achievementsRepo } = await import("./achievements/repo");
      count = await achievementsRepo.upsertDefinitions(
        gameId,
        ExternalAccountProvider.Goldberg,
        definitions.map((def, i) => ({
          externalId: def.name ?? "",
          // Resolve localised {english, ...} objects to a plain string — GBE's
          // local achievements.json stores title/description that way, and the
          // DB column is a String (Prisma rejects an object).
          title: resolveLocalised(def.displayName, def.name),
          description: resolveLocalised(def.description, ""),
          iconUrl: resolveGoldbergIcon(def.icon, appId),
          iconLockedUrl: resolveGoldbergIcon(def.icon_gray, appId),
          displayOrder: i,
          globalPercent: def.globalPercent ?? null,
        })),
      );

      log.info(
        `[GOLDBERG] Done: ${count} achievements for game=${gameId} appId=${appId}`,
      );
    }

    await maybeRegenerate();
    return result();
  } catch (e) {
    log.warn(`[GOLDBERG] Setup failed for game=${gameId}: ${e}`);
    // A failure part-way can still have written files; the manifest has to
    // match whatever is on disk now.
    await maybeRegenerate();
    return result();
  }

  async function maybeRegenerate() {
    if (manifestRegenerated) return;
    const mode = options?.manifest ?? "now";
    if (mode === "skip") return;
    if (!result().filesChanged) return;
    const versionId = options?.versionId;
    if (!versionId) {
      log.warn(
        `[GOLDBERG] Files under ${versionDir} changed but the caller gave no versionId, so ` +
          `no manifest was regenerated. Run "Regenerate Manifests".`,
      );
      return;
    }
    try {
      if (mode === "queue") {
        // Lazy import: the library manager's import pipeline imports this file.
        const { queueManifestRegeneration } = await import(
          "./library/manifest-queue"
        );
        const taskId = await queueManifestRegeneration(
          gameId,
          versionId,
          `achievement files changed for game ${gameId}`,
        );
        log.info(
          `[GOLDBERG] Files under ${versionDir} changed; manifest regeneration queued` +
            (taskId
              ? ` (worker task ${taskId})`
              : " (worker already running, or see above)"),
        );
        return;
      }
      const { libraryManager } = await import("./library");
      log.info(
        `[GOLDBERG] Files under ${versionDir} changed, regenerating the manifest for game=${gameId}`,
      );
      manifestRegenerated =
        await libraryManager.regenerateManifestForLatestVersion(gameId, log, {
          versionId,
        });
      if (!manifestRegenerated) {
        log.warn(
          `[GOLDBERG] Manifest was NOT regenerated for game=${gameId} (reason above). ` +
            `Clients may fail checksum validation until "Regenerate Manifests" runs.`,
        );
      }
    } catch (e) {
      log.warn(
        `[GOLDBERG] Manifest regeneration failed for game=${gameId}: ${e}. ` +
          `Run "Regenerate Manifests" before clients download this game.`,
      );
    }
  }
}
