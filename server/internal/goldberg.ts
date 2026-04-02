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
 * `saves_folder_name=drop-goldberg` into the game's `steam_settings/configs.user.ini`.
 * This makes unlocks land at:
 *   %APPDATA%/drop-goldberg/<AppID>/achievements.json  (Windows)
 *   ~/.local/share/drop-goldberg/<AppID>/achievements.json (Linux)
 *
 * The client also checks fallback paths for common Goldberg forks
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
 * Fetches achievement definitions from Steam's public API.
 * No API key required — `GetSchemaForGame` is public.
 *
 * Returns definitions in our standard format, or an empty array on failure.
 */
export async function fetchSteamAchievements(
  appId: string,
): Promise<GoldbergAchievementDef[]> {
  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appId}`;
  console.log(
    `[ACH-SETUP] Fetching achievements from Steam API for AppID ${appId}`,
  );

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(
        `[ACH-SETUP] Steam API returned ${res.status} for AppID ${appId}`,
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
        `[ACH-SETUP] No achievements in Steam API response for AppID ${appId}`,
      );
      return [];
    }

    console.log(
      `[ACH-SETUP] Got ${achievements.length} achievements from Steam API for AppID ${appId}`,
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
    console.log(`[ACH-SETUP] Steam API fetch failed for AppID ${appId}: ${e}`);
    return [];
  }
}

// ── Post-import achievement setup ──────────────────────────────────────────

/**
 * Called after a game version is imported. Handles the full achievement
 * pipeline:
 *
 * 1. Reads `steam_appid.txt` to get the AppID
 * 2. Reads local `achievements.json` — if missing, fetches from Steam API
 *    and writes it to disk so the Goldberg emulator can use it
 * 3. Creates/updates the `GameExternalLink` for Goldberg
 * 4. Upserts all `Achievement` records in the DB
 *
 * Failures are logged but never thrown — achievement setup should never
 * block a version import.
 */
export async function setupAchievementsForGame(
  gameId: string,
  versionDir: string,
): Promise<void> {
  try {
    const appId = readGoldbergAppId(versionDir);
    if (!appId) {
      console.log(`[ACH-SETUP] No steam_appid.txt in ${versionDir}, skipping`);
      return;
    }

    console.log(
      `[ACH-SETUP] Setting up achievements for game=${gameId} appId=${appId}`,
    );

    // Try local definitions first
    let definitions = readGoldbergDefinitions(versionDir);

    // If no local file, fetch from Steam and write to disk
    if (definitions.length === 0) {
      console.log(
        `[ACH-SETUP] No local achievements.json, fetching from Steam API`,
      );
      definitions = await fetchSteamAchievements(appId);

      if (definitions.length > 0) {
        // Write to disk so the Goldberg emulator can use them
        const steamSettings = path.join(versionDir, "steam_settings");
        if (!fs.existsSync(steamSettings)) {
          fs.mkdirSync(steamSettings, { recursive: true });
        }
        const achPath = path.join(steamSettings, "achievements.json");
        fs.writeFileSync(
          achPath,
          JSON.stringify(definitions, null, 2),
          "utf-8",
        );
        console.log(
          `[ACH-SETUP] Wrote ${definitions.length} achievements to ${achPath}`,
        );
      }
    }

    if (definitions.length === 0) {
      console.log(`[ACH-SETUP] No achievements found for AppID ${appId}`);
      return;
    }

    // Create/update the Goldberg external link
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

    // Upsert achievement definitions
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
      `[ACH-SETUP] Done: ${count} achievements for game=${gameId} appId=${appId}`,
    );
  } catch (e) {
    console.log(
      `[ACH-SETUP] Achievement setup failed for game=${gameId}: ${e}`,
    );
  }
}
