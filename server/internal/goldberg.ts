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

// ── Types ───────────────────────────────────────────────────────────────────

export interface GoldbergAchievementDef {
  /** Steam-style API name, e.g. "ACH_WIN_ONE_GAME" */
  name: string;
  displayName?: string;
  description?: string;
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
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      libraryPath: true,
      library: { select: { backend: true, options: true } },
      versions: {
        where: { versionPath: { not: null } },
        orderBy: { versionIndex: "desc" },
        take: 1,
        select: { versionPath: true },
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

  if (backend === "FlatFilesystem") {
    const resolved = path.join(options.baseDir, game.libraryPath);
    defaultLogger.info(
      `[PHASE:emulator] resolveGameVersionDir: FlatFilesystem => ${resolved}`,
    );
    return resolved;
  }

  const resolved = path.join(options.baseDir, game.libraryPath, versionPath);
  defaultLogger.info(
    `[PHASE:emulator] resolveGameVersionDir: Filesystem => baseDir="${options.baseDir}" libraryPath="${game.libraryPath}" versionPath="${versionPath}" => ${resolved}`,
  );
  return resolved;
}

/**
 * Reads the Goldberg achievement definition file from a game's directory.
 * Returns an empty array if the file doesn't exist.
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
    return data as GoldbergAchievementDef[];
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
 * 6. Regenerates the droplet manifest if the DLL was swapped, so client
 *    downloads don't fail checksum validation against the new bytes.
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
     * Logger that receives every status message. Defaults to the global
     * server logger; pass the task-context logger when running inside an
     * admin task so the swap progress shows up in the live task log.
     */
    logger?: GoldbergLogger;
  },
): Promise<void> {
  const log: GoldbergLogger = options?.logger ?? {
    info: (msg) => defaultLogger.info(msg),
    warn: (msg) => defaultLogger.warn(msg),
  };

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
        autoSwapSteamApiDll: true,
        library: { select: { autoSwapSteamApiDll: true } },
      },
    });

    // Effective swap policy: game override wins, otherwise inherit library.
    // Default to TRUE if for some reason both are missing.
    const autoSwapEnabled =
      gameRow?.autoSwapSteamApiDll ??
      gameRow?.library?.autoSwapSteamApiDll ??
      true;

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
      return;
    }

    log.info(
      `[GOLDBERG] Setting up game=${gameId} appId=${appId} dir=${settingsRoot}`,
    );

    // ── 2. Ensure steam_settings/ and steam_appid.txt exist on disk ──────
    const steamSettings = path.join(settingsRoot, "steam_settings");
    if (!fs.existsSync(steamSettings)) {
      fs.mkdirSync(steamSettings, { recursive: true });
      log.info(`[GOLDBERG] Created ${steamSettings}`);
    }

    const appIdPath = path.join(steamSettings, "steam_appid.txt");
    if (!fs.existsSync(appIdPath)) {
      fs.writeFileSync(appIdPath, appId, "utf-8");
      log.info(`[GOLDBERG] Wrote steam_appid.txt (${appId})`);
    }

    // ── 2b. Create the runtime save directory (drop-goldberg/<AppID>/) ───
    const saveDir = path.join(settingsRoot, "drop-goldberg", appId);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
      log.info(`[GOLDBERG] Created save dir ${saveDir}`);
    }

    // ── 2c. Ensure steam_api DLL is a GBE build ──────────────────────────
    // The swap is **opt-in**:
    //  - Library / game must have autoSwapSteamApiDll enabled.
    //  - DLL must be positively identified as vanilla Valve Steamworks
    //    (or already a GBE build, in which case no work is done).
    //  - Known-crack DLLs (OnlineFix, CODEX, EMPRESS, CreamAPI, …) and
    //    unidentifiable customs are LEFT IN PLACE.
    //
    // Historically this was opt-out: anything not matching a Goldberg
    // signature was assumed to be Valve and clobbered, destroying
    // pre-applied crack DLLs on every import. See `identifySteamApiDll`
    // in gbe.ts for the new fingerprinting model.
    let didSwapDll = false;
    if (!dllInfo) {
      log.info(
        `[GOLDBERG] No steam_api DLL found in ${settingsRoot}, skipping swap`,
      );
    } else if (!autoSwapEnabled) {
      log.info(
        `[GOLDBERG] autoSwapSteamApiDll is disabled for this game/library ` +
          `(game=${gameRow?.autoSwapSteamApiDll ?? "inherit"}, ` +
          `library=${gameRow?.library?.autoSwapSteamApiDll ?? "n/a"}). ` +
          `Leaving ${dllInfo.dllName} at ${dllInfo.dllDir} untouched.`,
      );
    } else {
      const { ensureGbeDll } = await import("./gbe");
      const result = await ensureGbeDll(
        dllInfo.dllDir,
        dllInfo.dllName,
        appId,
        log,
        // Scan the whole install for a loader crack (OnlineFix etc.) whose
        // steam_api DLL fingerprints as Valve — so we don't swap it and brick
        // multiplayer. The marker lives in a sibling file, not the DLL itself.
        { installRoot: versionDir },
      );
      if (result.swapped) {
        log.info(
          `[GOLDBERG] Swapped ${dllInfo.dllName} to GBE for game=${gameId} ` +
            `(appId=${appId}, dir=${dllInfo.dllDir}, ` +
            `fingerprint="${result.identification?.fingerprint ?? "n/a"}"). ` +
            `Original preserved as ${dllInfo.dllName}.steam_backup.`,
        );
        didSwapDll = true;
      } else if (result.alreadyGbe) {
        log.info(
          `[GOLDBERG] ${dllInfo.dllName} is already a GBE build for game=${gameId} ` +
            `— no swap needed (${result.identification?.fingerprint ?? "n/a"})`,
        );
      } else if (result.skipped) {
        log.warn(
          `[GOLDBERG] DLL swap NOT performed for ${dllInfo.dllName} (game=${gameId}, ` +
            `appId=${appId}, path=${dllInfo.dllDir}). ` +
            `Reason: ${result.identification?.fingerprint ?? "skipped"}. ` +
            `The game's pre-existing DLL has been left in place. ` +
            `If the game does not launch, flip its autoSwapSteamApiDll override on ` +
            `(see the per-game admin panel) to force the swap, or re-apply the crack manually.`,
        );
      } else {
        log.warn(
          `[GOLDBERG] DLL swap failed for ${dllInfo.dllName} (game=${gameId}): ${result.error ?? "unknown"}`,
        );
      }
    }

    // ── 3. Fetch/read achievement definitions ────────────────────────────
    const forceRefresh = options?.forceRefreshAchievements ?? false;
    let definitions = forceRefresh ? [] : readGoldbergDefinitions(settingsRoot);

    if (definitions.length === 0) {
      log.info(
        forceRefresh
          ? `[GOLDBERG] Force-refreshing achievements from Steam API`
          : `[GOLDBERG] No local achievements.json, fetching from Steam API`,
      );
      definitions = await fetchSteamAchievements(appId);
    }

    // Write definitions to steam_settings/ (array format — GBE reads these)
    // and a runtime seed to drop-goldberg/<AppID>/ (map format — GBE reads/writes)
    if (definitions.length > 0) {
      const defJson = JSON.stringify(definitions, null, 2);

      const settingsAchPath = path.join(steamSettings, "achievements.json");
      fs.writeFileSync(settingsAchPath, defJson, "utf-8");

      // Runtime file uses GBE's native map format:
      //   {"ACH_NAME": {"earned": false, "earned_time": 0}, ...}
      // This ensures GBE can read/write it correctly when achievements unlock.
      // Only write if the file doesn't already exist (preserve existing unlock state).
      const runtimeAchPath = path.join(saveDir, "achievements.json");
      if (!fs.existsSync(runtimeAchPath)) {
        const runtimeMap: Record<
          string,
          { earned: boolean; earned_time: number }
        > = {};
        for (const def of definitions) {
          if (def.name) {
            runtimeMap[def.name] = { earned: false, earned_time: 0 };
          }
        }
        fs.writeFileSync(
          runtimeAchPath,
          JSON.stringify(runtimeMap, null, 2),
          "utf-8",
        );
        log.info(
          `[GOLDBERG] Wrote ${definitions.length} achievements: definitions to steam_settings/, runtime seed (map format) to drop-goldberg/${appId}/`,
        );
      } else {
        log.info(
          `[GOLDBERG] Wrote ${definitions.length} definitions to steam_settings/ (runtime file already exists, preserved)`,
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
          title: def.displayName ?? def.name ?? "",
          description: def.description ?? "",
          iconUrl: def.icon ?? "",
          iconLockedUrl: def.icon_gray ?? "",
          displayOrder: i,
          globalPercent: def.globalPercent ?? null,
        })),
      );

      log.info(
        `[GOLDBERG] Done: ${count} achievements for game=${gameId} appId=${appId}`,
      );
    }

    // ── 6. Regenerate manifest if we swapped the DLL ─────────────────────
    // Swapping the steam_api DLL changes bytes on disk, which invalidates
    // the droplet manifest's per-file checksums for clients that verify on
    // download. Skipped when no swap happened (common case: already GBE).
    if (didSwapDll) {
      try {
        const { libraryManager } = await import("./library");
        const regenOk = await libraryManager.regenerateManifestForLatestVersion(
          gameId,
          log,
        );
        if (regenOk) {
          log.info(
            `[GOLDBERG] Regenerated manifest for game=${gameId} after DLL swap`,
          );
        } else {
          log.warn(
            `[GOLDBERG] Manifest regen FAILED for game=${gameId} — clients may hit checksum mismatches on next download`,
          );
        }
      } catch (e) {
        log.warn(`[GOLDBERG] Manifest regen threw for game=${gameId}: ${e}`);
      }
    }
  } catch (e) {
    log.warn(`[GOLDBERG] Setup failed for game=${gameId}: ${e}`);
  }
}
