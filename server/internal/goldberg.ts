import fs from "fs";
import path from "path";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

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

// ── Types ───────────────────────────────────────────────────────────────────

export interface GoldbergAchievementDef {
  /** Steam-style API name, e.g. "ACH_WIN_ONE_GAME" */
  name: string;
  displayName?: string;
  description?: string;
  icon?: string;
  icon_gray?: string;
  hidden?: number;
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
    console.log(
      `[ACH-SCAN] resolveGameVersionDir: no game or no versions for ${gameId}`,
    );
    return undefined;
  }

  const backend = game.library.backend;
  if (backend !== "Filesystem" && backend !== "FlatFilesystem") {
    console.log(
      `[ACH-SCAN] resolveGameVersionDir: unsupported backend "${backend}"`,
    );
    return undefined;
  }

  const options = game.library.options as { baseDir?: string };
  if (!options.baseDir) {
    console.log(
      `[ACH-SCAN] resolveGameVersionDir: no baseDir in library options`,
    );
    return undefined;
  }

  const versionPath = game.versions[0].versionPath!;

  if (backend === "FlatFilesystem") {
    const resolved = path.join(options.baseDir, game.libraryPath);
    console.log(
      `[ACH-SCAN] resolveGameVersionDir: FlatFilesystem => ${resolved}`,
    );
    return resolved;
  }

  const resolved = path.join(options.baseDir, game.libraryPath, versionPath);
  console.log(
    `[ACH-SCAN] resolveGameVersionDir: Filesystem => baseDir="${options.baseDir}" libraryPath="${game.libraryPath}" versionPath="${versionPath}" => ${resolved}`,
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
    console.log(
      `[GOLDBERG] STEAM_API_KEY not set, cannot fetch achievements for AppID ${appId}`,
    );
    return [];
  }

  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}`;
  console.log(
    `[GOLDBERG] Fetching achievements from Steam API for AppID ${appId}`,
  );

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(
        `[GOLDBERG] Steam API returned ${res.status} for AppID ${appId}`,
      );
      return [];
    }

    const json = (await res.json()) as {
      game?: {
        availableGameStats?: {
          achievements?: {
            name: string;
            displayName?: string;
            description?: string;
            icon?: string;
            icongray?: string;
            hidden?: number;
          }[];
        };
      };
    };

    const achievements = json.game?.availableGameStats?.achievements;
    if (!achievements || achievements.length === 0) {
      console.log(
        `[GOLDBERG] No achievements in Steam API response for AppID ${appId}`,
      );
      return [];
    }

    console.log(
      `[GOLDBERG] Got ${achievements.length} achievements from Steam API for AppID ${appId}`,
    );

    return achievements.map((a) => ({
      name: a.name,
      displayName: a.displayName,
      description: a.description,
      icon: a.icon,
      icon_gray: a.icongray,
      hidden: a.hidden,
    }));
  } catch (e) {
    console.log(`[GOLDBERG] Steam API fetch failed for AppID ${appId}: ${e}`);
    return [];
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
 * 3. Creates/updates the `GameExternalLink` (Goldberg ↔ AppID)
 * 4. Upserts all `Achievement` definition records in the DB
 *
 * Runtime config (`configs.user.ini`) is handled client-side at launch.
 *
 * Failures are logged but never thrown — Goldberg setup should never
 * block a version import.
 */
export async function setupGoldberg(
  gameId: string,
  versionDir: string,
  options?: { forceRefreshAchievements?: boolean },
): Promise<void> {
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
        console.log(
          `[GOLDBERG] Removed stale steam_settings/ at version root (DLL is in ${settingsRoot})`,
        );
      }
    }

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
        console.log(
          `[GOLDBERG] No steam_appid.txt, using DB link AppID ${appId}`,
        );
      }
    }

    // Fall back to the game's metadata — if it was imported from Steam,
    // metadataId IS the Steam AppID.
    if (!appId) {
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        select: { metadataSource: true, metadataId: true },
      });
      if (game?.metadataSource === "Steam" && game.metadataId) {
        appId = game.metadataId;
        console.log(
          `[GOLDBERG] No steam_appid.txt or DB link, using Steam metadata AppID ${appId}`,
        );
      }
    }

    if (!appId) {
      console.log(`[GOLDBERG] No AppID for ${versionDir}, skipping`);
      return;
    }

    console.log(
      `[GOLDBERG] Setting up game=${gameId} appId=${appId} dir=${settingsRoot}`,
    );

    // ── 2. Ensure steam_settings/ and steam_appid.txt exist on disk ──────
    const steamSettings = path.join(settingsRoot, "steam_settings");
    if (!fs.existsSync(steamSettings)) {
      fs.mkdirSync(steamSettings, { recursive: true });
      console.log(`[GOLDBERG] Created ${steamSettings}`);
    }

    const appIdPath = path.join(steamSettings, "steam_appid.txt");
    if (!fs.existsSync(appIdPath)) {
      fs.writeFileSync(appIdPath, appId, "utf-8");
      console.log(`[GOLDBERG] Wrote steam_appid.txt (${appId})`);
    }

    // ── 2b. Create the runtime save directory (drop-goldberg/<AppID>/) ───
    const saveDir = path.join(settingsRoot, "drop-goldberg", appId);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
      console.log(`[GOLDBERG] Created save dir ${saveDir}`);
    }

    // ── 3. Fetch/read achievement definitions ────────────────────────────
    const forceRefresh = options?.forceRefreshAchievements ?? false;
    let definitions = forceRefresh ? [] : readGoldbergDefinitions(settingsRoot);

    if (definitions.length === 0) {
      console.log(
        forceRefresh
          ? `[GOLDBERG] Force-refreshing achievements from Steam API`
          : `[GOLDBERG] No local achievements.json, fetching from Steam API`,
      );
      definitions = await fetchSteamAchievements(appId);
    }

    // Write definitions to both locations:
    //   steam_settings/achievements.json  — emulator reads definitions here
    //   drop-goldberg/<AppID>/achievements.json — emulator reads/writes runtime state here
    if (definitions.length > 0) {
      const json = JSON.stringify(definitions, null, 2);

      const settingsAchPath = path.join(steamSettings, "achievements.json");
      fs.writeFileSync(settingsAchPath, json, "utf-8");

      const runtimeAchPath = path.join(saveDir, "achievements.json");
      fs.writeFileSync(runtimeAchPath, json, "utf-8");

      console.log(
        `[GOLDBERG] Wrote ${definitions.length} achievements to steam_settings/ and drop-goldberg/${appId}/`,
      );
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
    if (definitions.length === 0) {
      console.log(`[GOLDBERG] No achievements found for AppID ${appId}`);
      return;
    }

    let count = 0;
    for (const def of definitions) {
      const apiName = def.name ?? "";
      if (!apiName) continue;

      await prisma.achievement.upsert({
        where: {
          gameId_provider_externalId: {
            gameId,
            provider: ExternalAccountProvider.Goldberg,
            externalId: apiName,
          },
        },
        create: {
          gameId,
          provider: ExternalAccountProvider.Goldberg,
          externalId: apiName,
          title: def.displayName ?? apiName,
          description: def.description ?? "",
          iconUrl: def.icon ?? "",
          iconLockedUrl: def.icon_gray ?? "",
          displayOrder: count,
        },
        update: {
          title: def.displayName ?? apiName,
          description: def.description ?? "",
          iconUrl: def.icon ?? "",
          iconLockedUrl: def.icon_gray ?? "",
          displayOrder: count,
        },
      });
      count++;
    }

    console.log(
      `[GOLDBERG] Done: ${count} achievements for game=${gameId} appId=${appId}`,
    );

    // ── 6. Auto-populate savePaths if not already set ────────────────────
    // Uses the <base> placeholder so the path resolves correctly on any
    // client machine. <base> = <root>/<game> = DATA_ROOT_DIR/games/<gameId>
    // which maps to the game's install directory.
    await autoSetSavePaths(gameId, versionDir, settingsRoot);
  } catch (e) {
    console.log(`[GOLDBERG] Setup failed for game=${gameId}: ${e}`);
  }
}

/**
 * Sets the game's `savePaths` to the Goldberg drop-goldberg directory
 * if no save paths are configured yet.
 *
 * The path uses the `<base>` placeholder so it resolves on any client:
 *   <base>/relative/path/to/drop-goldberg
 *
 * Where `<base>` expands to `DATA_ROOT_DIR/games/<gameId>` at runtime.
 */
async function autoSetSavePaths(
  gameId: string,
  versionDir: string,
  settingsRoot: string,
): Promise<void> {
  // Don't overwrite manually-configured save paths
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { savePaths: true },
  });
  if (game?.savePaths) {
    console.log(
      `[GOLDBERG] savePaths already set for ${gameId}, skipping auto-set`,
    );
    return;
  }

  // Build a placeholder-based path relative to the game root.
  // settingsRoot might be a subdirectory of versionDir (e.g. GameData/Plugins/x86_64/)
  const relative = path.relative(versionDir, settingsRoot);
  const segments =
    relative && relative !== "."
      ? `<base>/${relative.split(path.sep).join("/")}/drop-goldberg`
      : "<base>/drop-goldberg";

  const savePaths = JSON.stringify({
    files: [
      {
        path: segments,
        dataType: "file",
        tags: ["save"],
        conditions: [{ type: "os", value: "windows" }],
      },
      {
        path: segments,
        dataType: "file",
        tags: ["save"],
        conditions: [{ type: "os", value: "linux" }],
      },
    ],
  });

  await prisma.game.updateMany({
    where: { id: gameId },
    data: { savePaths },
  });

  console.log(`[GOLDBERG] Auto-set savePaths for ${gameId}: ${segments}`);
}

/**
 * Ensures every game has a `savePaths` value after version import.
 *
 * Goldberg games already get theirs from `autoSetSavePaths` (called by
 * `setupGoldberg`).  This function is the universal fallback — if no
 * savePaths were set by the time it runs, it writes a default path
 * pointing to `<base>/drop-saves`.
 *
 * The directory is also created on disk (inside the version directory)
 * so it's included in the download manifest and exists on the client
 * from the first install.
 *
 * For emulated games (ROMs), the emulator's launch command can be
 * configured to use `{dir}/drop-saves` as its save directory argument.
 */
export async function ensureDefaultSavePaths(
  gameId: string,
  versionDir: string | undefined,
): Promise<void> {
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { savePaths: true },
    });

    // Already set (by admin or by setupGoldberg) — nothing to do
    if (game?.savePaths) return;

    // Create the drop-saves directory on disk so it ships with the game
    if (versionDir) {
      const saveDir = path.join(versionDir, "drop-saves");
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
        console.log(`[SAVES] Created ${saveDir}`);
      }
    }

    const savePaths = JSON.stringify({
      files: [
        {
          path: "<base>/drop-saves",
          dataType: "file",
          tags: ["save"],
          conditions: [{ type: "os", value: "windows" }],
        },
        {
          path: "<base>/drop-saves",
          dataType: "file",
          tags: ["save"],
          conditions: [{ type: "os", value: "linux" }],
        },
      ],
    });

    await prisma.game.updateMany({
      where: { id: gameId },
      data: { savePaths },
    });

    console.log(
      `[SAVES] Auto-set default savePaths for ${gameId}: <base>/drop-saves`,
    );
  } catch (e) {
    console.log(`[SAVES] Failed to set default savePaths for ${gameId}: ${e}`);
  }
}
