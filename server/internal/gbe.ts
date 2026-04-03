/**
 * GBE (Goldberg Steam Emulator fork) DLL management.
 *
 * Downloads GBE release binaries from GitHub and caches them locally.
 * Used by the "Upgrade to GBE" task to replace SmartSteamEmu DLLs
 * with GBE equivalents that support achievement tracking.
 *
 * @see https://github.com/Detanup01/gbe_fork
 */

import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { systemConfig } from "./config/sys-conf";

const GBE_REPO = "Detanup01/gbe_fork";
const GBE_CACHE_DIR = "gbe-cache";

/** Architecture variants we care about. */
export type GbeArch = "win64" | "win32" | "linux";

/** Maps DLL filename → architecture. */
const DLL_TO_ARCH: Record<string, GbeArch> = {
  "steam_api64.dll": "win64",
  "steam_api.dll": "win32",
  "libsteam_api.so": "linux",
};

// ── Cache path helpers ────────────────────────────────────────────────────

function cacheRoot(): string {
  return path.join(systemConfig.getDataFolder(), GBE_CACHE_DIR);
}

function archDir(arch: GbeArch): string {
  return path.join(cacheRoot(), arch);
}

/** Returns true if we already have cached GBE DLLs for an architecture. */
export function hasCachedDlls(arch: GbeArch): boolean {
  const dir = archDir(arch);
  if (!fs.existsSync(dir)) return false;

  // Check for the actual DLL file
  const expected = arch === "win64"
    ? "steam_api64.dll"
    : arch === "win32"
      ? "steam_api.dll"
      : "libsteam_api.so";
  return fs.existsSync(path.join(dir, expected));
}

/** Returns the path to a cached GBE DLL, or undefined if not cached. */
export function getCachedDllPath(arch: GbeArch): string | undefined {
  const dir = archDir(arch);
  const expected = arch === "win64"
    ? "steam_api64.dll"
    : arch === "win32"
      ? "steam_api.dll"
      : "libsteam_api.so";
  const p = path.join(dir, expected);
  return fs.existsSync(p) ? p : undefined;
}

// ── GitHub release fetching ───────────────────────────────────────────────

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GhRelease {
  tag_name: string;
  name: string;
  assets: GhAsset[];
}

/**
 * Fetches the latest GBE release from GitHub and caches the DLLs locally.
 *
 * GBE releases contain zip archives with names like:
 *   - `emu-win-release.7z` (Windows 64-bit)
 *   - `emu-win32-release.7z` (Windows 32-bit)
 *   - `emu-linux-release.tar.gz` (Linux)
 *
 * Since we can't easily extract 7z in Node, we look for plain zip or
 * fall back to downloading individual DLLs from the repo.
 *
 * For now: this function downloads the release info and extracts what we need.
 * The actual DLL extraction may need the admin to manually place the DLLs
 * if automated extraction isn't feasible.
 */
export async function fetchLatestRelease(): Promise<GhRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GBE_REPO}/releases/latest`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      console.log(
        `[GBE] GitHub API returned ${res.status} fetching latest release`,
      );
      return null;
    }
    return (await res.json()) as GhRelease;
  } catch (e) {
    console.log(`[GBE] Failed to fetch latest release: ${e}`);
    return null;
  }
}

/**
 * Downloads a file from a URL to a local path.
 */
async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) {
      console.log(`[GBE] Download failed: ${res.status} from ${url}`);
      return false;
    }
    const fileStream = createWriteStream(dest);
    // @ts-expect-error - ReadableStream from fetch vs Node stream
    await pipeline(res.body, fileStream);
    return true;
  } catch (e) {
    console.log(`[GBE] Download error for ${url}: ${e}`);
    return false;
  }
}

/**
 * Downloads and caches GBE DLLs from the latest GitHub release.
 *
 * Returns the tag name of the downloaded release, or null on failure.
 *
 * NOTE: GBE releases use .7z format which requires an external tool to
 * extract. If the release contains .zip files we extract those; otherwise
 * the admin needs to manually place the DLLs in the cache directory.
 */
export async function downloadGbeDlls(): Promise<string | null> {
  const release = await fetchLatestRelease();
  if (!release) return null;

  console.log(
    `[GBE] Latest release: ${release.tag_name} (${release.assets.length} assets)`,
  );

  // Ensure cache dirs exist
  for (const arch of ["win64", "win32", "linux"] as GbeArch[]) {
    fs.mkdirSync(archDir(arch), { recursive: true });
  }

  // Look for zip assets we can extract
  let downloaded = false;
  for (const asset of release.assets) {
    const name = asset.name.toLowerCase();

    if (name.endsWith(".zip")) {
      // Try to download and extract zip files
      const tmpPath = path.join(cacheRoot(), asset.name);
      console.log(`[GBE] Downloading ${asset.name} (${asset.size} bytes)...`);

      if (await downloadFile(asset.browser_download_url, tmpPath)) {
        try {
          await extractZipDlls(tmpPath);
          downloaded = true;
        } catch (e) {
          console.log(`[GBE] Failed to extract ${asset.name}: ${e}`);
        }
        // Clean up zip
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!downloaded) {
    // GBE uses .7z — provide instructions for manual placement
    console.log(
      `[GBE] No .zip assets found in release ${release.tag_name}. ` +
        `GBE uses .7z archives which require manual extraction. ` +
        `Download from: https://github.com/${GBE_REPO}/releases/tag/${release.tag_name} ` +
        `and place DLLs in: ${cacheRoot()}/<arch>/`,
    );

    // Download .7z files so the admin can extract them manually
    for (const asset of release.assets) {
      const name = asset.name.toLowerCase();
      if (name.endsWith(".7z") || name.endsWith(".tar.gz")) {
        const destPath = path.join(cacheRoot(), asset.name);
        if (!fs.existsSync(destPath)) {
          console.log(`[GBE] Downloading ${asset.name} for manual extraction...`);
          await downloadFile(asset.browser_download_url, destPath);
        }
      }
    }
  }

  // Write version marker
  const versionFile = path.join(cacheRoot(), "version.txt");
  fs.writeFileSync(versionFile, release.tag_name, "utf-8");

  return release.tag_name;
}

/**
 * Extracts steam_api DLLs from a zip file into the cache directory.
 */
async function extractZipDlls(zipPath: string): Promise<void> {
  // Use Node's built-in unzip via child_process
  const { execSync } = await import("child_process");

  const tmpDir = zipPath + "_extracted";
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" });

    // Find and copy DLL files
    findAndCacheDlls(tmpDir);
  } finally {
    // Clean up extracted dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Recursively searches a directory for Steam API DLLs and copies them
 * to the appropriate cache directory.
 */
function findAndCacheDlls(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findAndCacheDlls(fullPath);
      continue;
    }

    const lower = entry.name.toLowerCase();
    const arch = DLL_TO_ARCH[lower];
    if (arch) {
      const dest = path.join(archDir(arch), entry.name);
      fs.copyFileSync(fullPath, dest);
      console.log(`[GBE] Cached ${entry.name} → ${dest}`);
    }
  }
}

// ── SSE → GBE replacement ─────────────────────────────────────────────────

/** Files that get backed up before replacement. */
const BACKUP_SUFFIX = ".sse_backup";

/** The DLL filenames we look for (same as client-side). */
const STEAM_API_DLLS = [
  "steam_api64.dll",
  "steam_api.dll",
  "libsteam_api.so",
];

/**
 * Recursively finds the directory containing a Steam API DLL within a
 * game's version directory. Returns the directory path and the DLL name.
 */
export function findSteamApiDll(
  rootDir: string,
): { dllDir: string; dllName: string } | null {
  return findSteamApiDllRecursive(rootDir, 0, 5);
}

function findSteamApiDllRecursive(
  dir: string,
  depth: number,
  maxDepth: number,
): { dllDir: string; dllName: string } | null {
  if (depth > maxDepth) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Check files in this directory first
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    for (const dll of STEAM_API_DLLS) {
      if (lower === dll) {
        return { dllDir: dir, dllName: entry.name };
      }
    }
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findSteamApiDllRecursive(
      path.join(dir, entry.name),
      depth + 1,
      maxDepth,
    );
    if (found) return found;
  }

  return null;
}

/** Detected emulator type for a game directory. */
export type EmulatorType = "goldberg" | "sse" | "unknown";

/** Result of detecting which emulator a game uses. */
export interface EmulatorDetection {
  type: EmulatorType;
  dllDir: string;
  dllName: string;
  /** Parsed SSE config (only when type === "sse") */
  sseConfig?: SseConfig;
}

/** Parsed contents of steam_emu.ini */
export interface SseConfig {
  appId: string;
  userName?: string;
  language?: string;
  /** DLC entries: appId → name */
  dlcs: Map<string, string>;
  /** Steam API interface versions */
  interfaces: Map<string, string>;
}

/**
 * Detects which Steam emulator a game directory uses.
 */
export function detectEmulator(versionDir: string): EmulatorDetection | null {
  const dllInfo = findSteamApiDll(versionDir);
  if (!dllInfo) return null;

  const { dllDir, dllName } = dllInfo;

  // Check for SSE first (steam_emu.ini next to DLL)
  const sseIniPath = path.join(dllDir, "steam_emu.ini");
  if (fs.existsSync(sseIniPath)) {
    const sseConfig = parseSseIni(sseIniPath);
    return {
      type: "sse",
      dllDir,
      dllName,
      sseConfig: sseConfig ?? undefined,
    };
  }

  // Check for Goldberg (steam_settings/ next to DLL)
  const steamSettings = path.join(dllDir, "steam_settings");
  if (fs.existsSync(steamSettings)) {
    return { type: "goldberg", dllDir, dllName };
  }

  return { type: "unknown", dllDir, dllName };
}

// ── SSE ini parser ────────────────────────────────────────────────────────

/**
 * Parses a SmartSteamEmu `steam_emu.ini` file.
 */
export function parseSseIni(iniPath: string): SseConfig | null {
  let content: string;
  try {
    content = fs.readFileSync(iniPath, "utf-8");
  } catch {
    return null;
  }

  let appId = "";
  let userName: string | undefined;
  let language: string | undefined;
  const dlcs = new Map<string, string>();
  const interfaces = new Map<string, string>();

  let currentSection = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    // Section header
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    // Key=Value
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    switch (currentSection) {
      case "Settings":
        if (key === "AppId") appId = value;
        else if (key === "UserName") userName = value;
        else if (key === "Language") language = value;
        break;

      case "DLC":
        // Skip DLCUnlockall and other non-numeric keys
        if (/^\d+$/.test(key)) {
          dlcs.set(key, value);
        }
        break;

      case "Interfaces":
        interfaces.set(key, value);
        break;
    }
  }

  if (!appId) return null;

  return { appId, userName, language, dlcs, interfaces };
}

// ── SSE → GBE conversion ─────────────────────────────────────────────────

export interface UpgradeResult {
  success: boolean;
  message: string;
  backupCreated: boolean;
}

/**
 * Replaces an SSE installation with GBE for a single game.
 *
 * Steps:
 * 1. Detect SSE and parse its config
 * 2. Check that we have cached GBE DLLs for the right architecture
 * 3. Back up SSE files (DLL + steam_emu.ini)
 * 4. Copy GBE DLL in place
 * 5. Create steam_settings/ with converted config
 * 6. Write achievements.json from DB/Steam API
 */
export async function upgradeSseToGbe(
  versionDir: string,
  gameId: string,
  detection: EmulatorDetection,
  logger: { info: (msg: string) => void },
): Promise<UpgradeResult> {
  const { dllDir, dllName, sseConfig } = detection;

  if (!sseConfig) {
    return {
      success: false,
      message: "Could not parse steam_emu.ini",
      backupCreated: false,
    };
  }

  // Determine architecture from DLL name
  const arch = DLL_TO_ARCH[dllName.toLowerCase()];
  if (!arch) {
    return {
      success: false,
      message: `Unknown DLL: ${dllName}`,
      backupCreated: false,
    };
  }

  // Check for cached GBE DLL
  const gbeDllPath = getCachedDllPath(arch);
  if (!gbeDllPath) {
    return {
      success: false,
      message: `No cached GBE DLL for ${arch}. Run "Download GBE" task first.`,
      backupCreated: false,
    };
  }

  // ── Step 1: Back up SSE files ──────────────────────────────────────────
  const dllPath = path.join(dllDir, dllName);
  const sseIniPath = path.join(dllDir, "steam_emu.ini");
  const dllBackup = dllPath + BACKUP_SUFFIX;
  const iniBackup = sseIniPath + BACKUP_SUFFIX;

  try {
    if (fs.existsSync(dllPath) && !fs.existsSync(dllBackup)) {
      fs.copyFileSync(dllPath, dllBackup);
      logger.info(`Backed up ${dllName} → ${dllName}${BACKUP_SUFFIX}`);
    }
    if (fs.existsSync(sseIniPath) && !fs.existsSync(iniBackup)) {
      fs.copyFileSync(sseIniPath, iniBackup);
      logger.info(`Backed up steam_emu.ini → steam_emu.ini${BACKUP_SUFFIX}`);
    }
  } catch (e) {
    return {
      success: false,
      message: `Backup failed: ${e}`,
      backupCreated: false,
    };
  }

  // ── Step 2: Replace DLL ────────────────────────────────────────────────
  try {
    fs.copyFileSync(gbeDllPath, dllPath);
    logger.info(`Replaced ${dllName} with GBE version`);
  } catch (e) {
    return {
      success: false,
      message: `DLL replacement failed: ${e}`,
      backupCreated: true,
    };
  }

  // ── Step 3: Create steam_settings/ ─────────────────────────────────────
  const steamSettings = path.join(dllDir, "steam_settings");
  fs.mkdirSync(steamSettings, { recursive: true });

  // steam_appid.txt
  fs.writeFileSync(
    path.join(steamSettings, "steam_appid.txt"),
    sseConfig.appId,
    "utf-8",
  );
  logger.info(`Wrote steam_appid.txt (${sseConfig.appId})`);

  // steam_interfaces.txt — converted from SSE's [Interfaces] section
  if (sseConfig.interfaces.size > 0) {
    const interfaceLines = Array.from(sseConfig.interfaces.values());
    fs.writeFileSync(
      path.join(steamSettings, "steam_interfaces.txt"),
      interfaceLines.join("\n") + "\n",
      "utf-8",
    );
    logger.info(
      `Wrote steam_interfaces.txt (${interfaceLines.length} interfaces)`,
    );
  }

  // dlc.txt — converted from SSE's [DLC] section
  if (sseConfig.dlcs.size > 0) {
    const dlcLines = Array.from(sseConfig.dlcs.entries())
      .map(([id, name]) => `${id}=${name}`)
      .join("\n");
    fs.writeFileSync(
      path.join(steamSettings, "dlc.txt"),
      dlcLines + "\n",
      "utf-8",
    );
    logger.info(`Wrote dlc.txt (${sseConfig.dlcs.size} DLCs)`);
  }

  // configs.user.ini — local_save_path for portable saves
  const configsUserIni = `[user::saves]\nlocal_save_path=./drop-goldberg\n`;
  fs.writeFileSync(
    path.join(steamSettings, "configs.user.ini"),
    configsUserIni,
    "utf-8",
  );
  logger.info("Wrote configs.user.ini (local_save_path=./drop-goldberg)");

  // ── Step 4: Write achievements.json from DB ────────────────────────────
  // Import here to avoid circular deps
  const {
    readGoldbergDefinitions,
    fetchSteamAchievements,
    setupGoldberg,
  } = await import("./goldberg");

  // Check if achievements are already on disk (from a previous server-side setup)
  const existingDefs = readGoldbergDefinitions(dllDir);
  if (existingDefs.length > 0) {
    logger.info(
      `achievements.json already exists with ${existingDefs.length} entries`,
    );
  } else {
    // Try fetching from Steam API
    const steamDefs = await fetchSteamAchievements(sseConfig.appId);
    if (steamDefs.length > 0) {
      fs.writeFileSync(
        path.join(steamSettings, "achievements.json"),
        JSON.stringify(steamDefs, null, 2),
        "utf-8",
      );
      logger.info(
        `Wrote achievements.json (${steamDefs.length} from Steam API)`,
      );
    } else {
      logger.info("No achievements found from Steam API");
    }
  }

  // Run full Goldberg setup to ensure DB records are in sync
  // Use dllDir as the versionDir since that's where steam_settings/ is now
  try {
    await setupGoldberg(gameId, dllDir);
  } catch (e) {
    logger.info(`setupGoldberg follow-up failed (non-critical): ${e}`);
  }

  // ── Step 5: Remove SSE config (optional, keep backup) ─────────────────
  // We don't delete steam_emu.ini — it's harmless and GBE ignores it.
  // The backup is already created above.

  return {
    success: true,
    message: `Upgraded to GBE (AppID ${sseConfig.appId}, ${sseConfig.dlcs.size} DLCs, ${sseConfig.interfaces.size} interfaces)`,
    backupCreated: true,
  };
}

/**
 * Reverts a GBE upgrade by restoring SSE backup files.
 */
export function revertToSse(
  dllDir: string,
  dllName: string,
): { success: boolean; message: string } {
  const dllPath = path.join(dllDir, dllName);
  const sseIniPath = path.join(dllDir, "steam_emu.ini");
  const dllBackup = dllPath + BACKUP_SUFFIX;
  const iniBackup = sseIniPath + BACKUP_SUFFIX;

  if (!fs.existsSync(dllBackup)) {
    return {
      success: false,
      message: `No backup found at ${dllBackup}`,
    };
  }

  try {
    fs.copyFileSync(dllBackup, dllPath);
    if (fs.existsSync(iniBackup)) {
      fs.copyFileSync(iniBackup, sseIniPath);
    }

    // Clean up steam_settings/ that we created
    const steamSettings = path.join(dllDir, "steam_settings");
    if (fs.existsSync(steamSettings)) {
      fs.rmSync(steamSettings, { recursive: true, force: true });
    }

    return {
      success: true,
      message: "Reverted to SSE successfully",
    };
  } catch (e) {
    return {
      success: false,
      message: `Revert failed: ${e}`,
    };
  }
}
