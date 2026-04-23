/**
 * GBE (Goldberg Steam Emulator fork) DLL management.
 *
 * Downloads GBE release binaries from GitHub and caches them locally.
 * Used by the "Upgrade to GBE" task to replace SmartSteamEmu DLLs
 * with GBE equivalents that support achievement tracking.
 *
 * @see https://github.com/Detanup01/gbe_fork
 */

import fs, { createWriteStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { systemConfig } from "./config/sys-conf";
import { logger } from "~/server/internal/logging";

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
  const expected =
    arch === "win64"
      ? "steam_api64.dll"
      : arch === "win32"
        ? "steam_api.dll"
        : "libsteam_api.so";
  return fs.existsSync(path.join(dir, expected));
}

/** Returns the path to a cached GBE DLL, or undefined if not cached. */
export function getCachedDllPath(arch: GbeArch): string | undefined {
  const dir = archDir(arch);
  const expected =
    arch === "win64"
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
 * GBE releases contain archives with names like:
 *   - `emu-win-release.7z` (Windows 64-bit)
 *   - `emu-win32-release.7z` (Windows 32-bit)
 *   - `emu-linux-release.tar.gz` (Linux)
 *
 * Extracts archives using p7zip (installed in the Docker image).
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
 * Supports .zip (unzip), .7z (7z from p7zip-full), and .tar.gz (tar).
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

  // We only need the "emu-win-release" archive (contains both 32 and 64-bit DLLs)
  // Prioritise: .zip > .7z > .tar.gz
  const emuAssets = release.assets.filter((a) => {
    const name = a.name.toLowerCase();
    return (
      name.startsWith("emu-") &&
      name.includes("release") &&
      !name.includes("debug") &&
      (name.endsWith(".zip") ||
        name.endsWith(".7z") ||
        name.endsWith(".tar.gz"))
    );
  });

  // Sort by extension preference
  const extPriority = (name: string) =>
    name.endsWith(".zip") ? 0 : name.endsWith(".7z") ? 1 : 2;
  emuAssets.sort(
    (a, b) =>
      extPriority(a.name.toLowerCase()) - extPriority(b.name.toLowerCase()),
  );

  let downloaded = false;

  for (const asset of emuAssets) {
    const tmpPath = path.join(cacheRoot(), asset.name);
    console.log(`[GBE] Downloading ${asset.name} (${asset.size} bytes)...`);

    if (!(await downloadFile(asset.browser_download_url, tmpPath))) {
      continue;
    }

    try {
      await extractArchiveDlls(tmpPath, asset.name);
      downloaded = true;
    } catch (e) {
      console.log(`[GBE] Failed to extract ${asset.name}: ${e}`);
    }

    // Clean up archive
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }

    if (downloaded) break;
  }

  if (!downloaded) {
    console.log(
      `[GBE] Could not extract DLLs from release ${release.tag_name}. ` +
        `Ensure p7zip-full is installed (apt-get install p7zip-full).`,
    );
  }

  // Write version marker
  const versionFile = path.join(cacheRoot(), "version.txt");
  fs.writeFileSync(versionFile, release.tag_name, "utf-8");

  return downloaded ? release.tag_name : null;
}

/**
 * Extracts steam_api DLLs from an archive into the cache directory.
 * Supports .zip, .7z, and .tar.gz.
 */
async function extractArchiveDlls(
  archivePath: string,
  fileName: string,
): Promise<void> {
  const { execFileSync } = await import("child_process");
  const tmpDir = archivePath + "_extracted";
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".zip")) {
      execFileSync("unzip", ["-o", archivePath, "-d", tmpDir], {
        stdio: "pipe",
      });
    } else if (lower.endsWith(".7z")) {
      // p7zip-full is installed in the Docker image
      execFileSync("7z", ["x", "-y", `-o${tmpDir}`, archivePath], {
        stdio: "pipe",
      });
    } else if (lower.endsWith(".tar.gz")) {
      execFileSync("tar", ["xzf", archivePath, "-C", tmpDir], {
        stdio: "pipe",
      });
    } else {
      throw new Error(`Unsupported archive format: ${fileName}`);
    }

    logger.info(`[GBE] Extracted ${fileName}, scanning for DLLs...`);
    findAndCacheDlls(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Recursively searches a directory for Steam API DLLs and copies them
 * to the appropriate cache directory.
 *
 * GBE archives may contain multiple copies of the same DLL in different
 * subdirectories (e.g. `regular/` and `experimental/`). We prefer
 * `experimental` builds when available since they have more features.
 */
function findAndCacheDlls(dir: string): void {
  // Collect all DLL paths first so we can pick the best variant
  const found = new Map<GbeArch, { path: string; score: number }>();

  function scan(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath);
        continue;
      }

      const lower = entry.name.toLowerCase();
      const arch = DLL_TO_ARCH[lower];
      if (!arch) continue;

      // Score: prefer experimental > regular > other
      const dirLower = fullPath.toLowerCase();
      const score = dirLower.includes("experimental")
        ? 2
        : dirLower.includes("regular")
          ? 1
          : 0;

      const existing = found.get(arch);
      if (!existing || score > existing.score) {
        found.set(arch, { path: fullPath, score });
      }
    }
  }

  scan(dir);

  for (const [arch, info] of found) {
    const dllName = path.basename(info.path);
    const dest = path.join(archDir(arch), dllName);
    fs.copyFileSync(info.path, dest);
    console.log(`[GBE] Cached ${dllName} → ${dest}`);
  }
}

// ── SSE → GBE replacement ─────────────────────────────────────────────────

/** Files that get backed up before replacement. */
const BACKUP_SUFFIX = ".sse_backup";

/** Suffix used when backing up a legitimate Steam DLL before the GBE swap. */
const STEAM_DRM_BACKUP_SUFFIX = ".steam_backup";

/** The DLL filenames we look for (same as client-side). */
const STEAM_API_DLLS = ["steam_api64.dll", "steam_api.dll", "libsteam_api.so"];

/**
 * Files whose presence near a game binary strongly signals real Steam DRM.
 * These are shipped by Steam itself when a game is built with Steam DRM
 * wrappers, and do not appear in SSE/Goldberg-cracked releases.
 */
const STEAM_DRM_MARKERS = ["steamclient64.dll", "gameoverlayrenderer64.dll"];

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

/**
 * Returns true if `rootDir` (recursively, bounded depth) contains any
 * file from STEAM_DRM_MARKERS. Used as a cheap signal that a game ships
 * with real Steam DRM rather than an emulator.
 */
export function hasSteamDrmMarker(rootDir: string): boolean {
  return hasSteamDrmMarkerRecursive(rootDir, 0, 5);
}

function hasSteamDrmMarkerRecursive(
  dir: string,
  depth: number,
  maxDepth: number,
): boolean {
  if (depth > maxDepth) return false;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (STEAM_DRM_MARKERS.includes(entry.name.toLowerCase())) return true;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      hasSteamDrmMarkerRecursive(
        path.join(dir, entry.name),
        depth + 1,
        maxDepth,
      )
    ) {
      return true;
    }
  }

  return false;
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

// ── Auto-upgrade helpers (shared between SSE and Steam-DRM paths) ────────

/**
 * Options for swapping a Steam API DLL with the GBE equivalent and
 * writing the `steam_settings/` config directory next to it.
 */
interface SwapOptions {
  dllDir: string;
  dllName: string;
  appId: string;
  backupSuffix: string;
  /** Optional SSE [Interfaces] block, written as steam_interfaces.txt. */
  interfaces?: Map<string, string>;
  /** Optional SSE [DLC] block, written as dlc.txt. */
  dlcs?: Map<string, string>;
}

/**
 * Ensures a cached GBE DLL, backs up the original in place, swaps the DLL,
 * and writes `steam_settings/{steam_appid.txt, configs.user.ini}` plus any
 * extras provided by the caller.
 *
 * Returns true on success. Logs and returns false on recoverable failures
 * so callers can decide whether to continue the import.
 */
async function swapDllAndWriteSettings(
  opts: SwapOptions,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<boolean> {
  const arch = DLL_TO_ARCH[opts.dllName.toLowerCase()];
  if (!arch) {
    logger.warn(`[GBE] Unknown DLL: ${opts.dllName}, skipping swap`);
    return false;
  }

  if (!hasCachedDlls(arch)) {
    logger.info(`[GBE] No cached GBE DLL for ${arch}, downloading...`);
    const tag = await downloadGbeDlls();
    if (!tag || !hasCachedDlls(arch)) {
      logger.warn(
        `[GBE] Failed to download GBE DLLs. Run "Download GBE" task manually.`,
      );
      return false;
    }
    logger.info(`[GBE] Downloaded GBE release ${tag}`);
  }

  const gbeDllPath = getCachedDllPath(arch)!;
  const dllPath = path.join(opts.dllDir, opts.dllName);
  const backupPath = dllPath + opts.backupSuffix;

  if (fs.existsSync(dllPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(dllPath, backupPath);
    logger.info(
      `[GBE] Backed up ${opts.dllName} → ${opts.dllName}${opts.backupSuffix}`,
    );
  }

  fs.copyFileSync(gbeDllPath, dllPath);
  logger.info(`[GBE] Replaced ${opts.dllName} with GBE version`);

  const steamSettings = path.join(opts.dllDir, "steam_settings");
  fs.mkdirSync(steamSettings, { recursive: true });

  fs.writeFileSync(
    path.join(steamSettings, "steam_appid.txt"),
    opts.appId,
    "utf-8",
  );

  if (opts.interfaces && opts.interfaces.size > 0) {
    const lines = Array.from(opts.interfaces.values());
    fs.writeFileSync(
      path.join(steamSettings, "steam_interfaces.txt"),
      lines.join("\n") + "\n",
      "utf-8",
    );
    logger.info(
      `[GBE] Wrote steam_interfaces.txt (${lines.length} interfaces)`,
    );
  }

  if (opts.dlcs && opts.dlcs.size > 0) {
    const dlcLines = Array.from(opts.dlcs.entries())
      .map(([id, name]) => `${id}=${name}`)
      .join("\n");
    fs.writeFileSync(
      path.join(steamSettings, "dlc.txt"),
      dlcLines + "\n",
      "utf-8",
    );
    logger.info(`[GBE] Wrote dlc.txt (${opts.dlcs.size} DLCs)`);
  }

  const configsUserIni = `[user::saves]\nlocal_save_path=./drop-goldberg\n`;
  fs.writeFileSync(
    path.join(steamSettings, "configs.user.ini"),
    configsUserIni,
    "utf-8",
  );

  return true;
}

// ── Auto SSE → GBE at import time ────────────────────────────────────────

/**
 * Called during version import, BEFORE the manifest is generated.
 *
 * If the game uses SmartSteamEmu (SSE), this function:
 *   1. Detects SSE (steam_emu.ini next to the DLL)
 *   2. Ensures GBE DLLs are cached (downloads if needed)
 *   3. Backs up the SSE DLL
 *   4. Replaces it with the GBE DLL
 *   5. Creates steam_settings/ with config from SSE ini
 *
 * Because this runs before manifest generation, the checksums will be
 * computed over the GBE DLL — no mismatch on client downloads.
 */
export async function autoUpgradeSseIfNeeded(
  versionDir: string,
  gameId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const detection = detectEmulator(versionDir);
  if (!detection) return;

  if (detection.type !== "sse" || !detection.sseConfig) {
    logger.info(
      `[GBE] Game ${gameId}: emulator is ${detection.type}, no SSE upgrade needed`,
    );
    return;
  }

  logger.info(
    `[GBE] Game ${gameId}: SSE detected (AppID ${detection.sseConfig.appId}), auto-upgrading to GBE`,
  );

  const ok = await swapDllAndWriteSettings(
    {
      dllDir: detection.dllDir,
      dllName: detection.dllName,
      appId: detection.sseConfig.appId,
      backupSuffix: BACKUP_SUFFIX,
      interfaces: detection.sseConfig.interfaces,
      dlcs: detection.sseConfig.dlcs,
    },
    logger,
  );

  if (ok) {
    logger.info(
      `[GBE] Auto-upgraded ${gameId} from SSE to GBE (AppID ${detection.sseConfig.appId})`,
    );
  }
}

// ── Auto Steam-DRM → GBE at import time ──────────────────────────────────

/**
 * Called during version import, BEFORE the manifest is generated.
 *
 * For games that ship with **legitimate Steam DRM** (identified by
 * `steamclient64.dll` / `gameoverlayrenderer64.dll` anywhere under the
 * version directory), swaps the bundled `steam_api64.dll` for the GBE
 * equivalent so the game can `SteamAPI_Init()` without a real Steam
 * client running.
 *
 * Skips when:
 *   - `appId` is not provided (no Steam metadata → nothing to write)
 *   - No Steam DRM markers are found (game is already DRM-free or
 *     the SSE path already handled it)
 *   - `steam_settings/` already exists next to the DLL (another path
 *     has already configured the emulator)
 *
 * The original DLL is preserved as `<dll>.steam_backup` so the
 * upgrade can be reversed later.
 */
export async function autoUpgradeSteamDrmIfNeeded(
  versionDir: string,
  gameId: string,
  appId: string | undefined,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  if (!appId) {
    logger.info(
      `[GBE] Game ${gameId}: no Steam AppID in metadata, skipping DRM upgrade`,
    );
    return;
  }

  if (!hasSteamDrmMarker(versionDir)) {
    logger.info(
      `[GBE] Game ${gameId}: no Steam DRM markers present, skipping DRM upgrade`,
    );
    return;
  }

  const dllInfo = findSteamApiDll(versionDir);
  if (!dllInfo) {
    logger.info(
      `[GBE] Game ${gameId}: Steam DRM markers found but no steam_api DLL, skipping`,
    );
    return;
  }

  // If steam_settings/ already exists, another code path (e.g. SSE upgrade
  // or a previous import run) has already configured the emulator — don't
  // re-swap, that would overwrite a GBE DLL with a second GBE DLL and
  // invalidate the existing `.sse_backup` / `.steam_backup`.
  if (fs.existsSync(path.join(dllInfo.dllDir, "steam_settings"))) {
    logger.info(
      `[GBE] Game ${gameId}: steam_settings/ already exists adjacent to DLL, skipping DRM upgrade`,
    );
    return;
  }

  logger.info(
    `[GBE] Game ${gameId}: Steam DRM detected (AppID ${appId}), auto-upgrading to GBE`,
  );

  const ok = await swapDllAndWriteSettings(
    {
      dllDir: dllInfo.dllDir,
      dllName: dllInfo.dllName,
      appId,
      backupSuffix: STEAM_DRM_BACKUP_SUFFIX,
    },
    logger,
  );

  if (ok) {
    logger.info(
      `[GBE] Auto-upgraded ${gameId} from Steam DRM to GBE (AppID ${appId})`,
    );
  }
}

// ── SSE → GBE conversion (admin-triggered, post-import) ─────────────────

export interface UpgradeResult {
  success: boolean;
  message: string;
  backupCreated: boolean;
}

/**
 * Admin-triggered SSE → GBE upgrade.
 *
 * Swaps the bundled SSE `steam_api*.dll` on disk for the cached GBE
 * equivalent, writes `steam_settings/` next to it (converted from the
 * SSE `steam_emu.ini`), runs full Goldberg setup so DB records are in
 * sync, and regenerates the game's droplet manifest + file list so the
 * depot checksums match the new DLL.
 *
 * The original DLL is preserved as `<dll>.sse_backup` for reversion.
 *
 * Safe to run repeatedly — the shared helper is idempotent w.r.t. the
 * backup file (it is only written when absent).
 */
export async function upgradeSseToGbe(
  versionDir: string,
  gameId: string,
  detection: EmulatorDetection,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<UpgradeResult> {
  const { dllDir, dllName, sseConfig } = detection;

  if (!sseConfig) {
    return {
      success: false,
      message: "Could not parse steam_emu.ini",
      backupCreated: false,
    };
  }

  const ok = await swapDllAndWriteSettings(
    {
      dllDir,
      dllName,
      appId: sseConfig.appId,
      backupSuffix: BACKUP_SUFFIX,
      interfaces: sseConfig.interfaces,
      dlcs: sseConfig.dlcs,
    },
    logger,
  );

  if (!ok) {
    return {
      success: false,
      message: `Failed to swap ${dllName} with GBE DLL — check server logs`,
      backupCreated: false,
    };
  }

  // ── Achievements + DB sync ──────────────────────────────────────────────
  const { readGoldbergDefinitions, fetchSteamAchievements, setupGoldberg } =
    await import("./goldberg");

  const steamSettings = path.join(dllDir, "steam_settings");
  const existingDefs = readGoldbergDefinitions(dllDir);
  if (existingDefs.length > 0) {
    logger.info(
      `achievements.json already exists with ${existingDefs.length} entries`,
    );
  } else {
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

  try {
    await setupGoldberg(gameId, dllDir);
  } catch (e) {
    logger.warn(`setupGoldberg follow-up failed (non-critical): ${e}`);
  }

  // ── Regenerate manifest so checksums match the new DLL ─────────────────
  const { libraryManager } = await import("./library");
  const regenOk = await libraryManager.regenerateManifestForLatestVersion(
    gameId,
    logger,
  );
  if (!regenOk) {
    logger.warn(
      `Manifest regen did not complete — downloads may fail checksum validation until re-imported`,
    );
  }

  return {
    success: true,
    message: `Swapped ${dllName} → GBE (AppID ${sseConfig.appId}, ${sseConfig.dlcs.size} DLCs, ${sseConfig.interfaces.size} interfaces)${regenOk ? ", manifest regenerated" : " — manifest regen FAILED"}`,
    backupCreated: true,
  };
}

// ── Steam DRM → GBE conversion (admin-triggered, post-import) ────────────

/**
 * Admin-triggered Steam DRM → GBE upgrade.
 *
 * Parallel to upgradeSseToGbe but targets games that shipped with real
 * Steam DRM (steamclient64.dll / gameoverlayrenderer64.dll) rather than
 * SmartSteamEmu. Swaps the bundled `steam_api*.dll` on disk for the GBE
 * equivalent, writes `steam_settings/` next to it with the supplied
 * AppID, runs Goldberg setup, and regenerates the droplet manifest so
 * depot checksums reflect the new DLL.
 *
 * The original DLL is preserved as `<dll>.steam_backup` for reversion.
 *
 * Idempotent: if a `.steam_backup` already exists we treat the game as
 * already upgraded and skip the swap (but still refresh settings + regen).
 */
export async function upgradeSteamDrmToGbe(
  versionDir: string,
  gameId: string,
  appId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<UpgradeResult> {
  if (!hasSteamDrmMarker(versionDir)) {
    return {
      success: false,
      message:
        "No Steam DRM markers (steamclient64.dll / gameoverlayrenderer64.dll) found in game directory",
      backupCreated: false,
    };
  }

  const dllInfo = findSteamApiDll(versionDir);
  if (!dllInfo) {
    return {
      success: false,
      message:
        "Steam DRM markers found but no steam_api DLL present in game directory",
      backupCreated: false,
    };
  }

  const { dllDir, dllName } = dllInfo;
  const backupPath = path.join(dllDir, dllName) + STEAM_DRM_BACKUP_SUFFIX;
  const alreadyUpgraded = fs.existsSync(backupPath);

  if (alreadyUpgraded) {
    logger.info(
      `${dllName}${STEAM_DRM_BACKUP_SUFFIX} already exists — treating as previously upgraded, refreshing settings only`,
    );
    // Ensure steam_settings/steam_appid.txt + configs.user.ini exist
    const steamSettings = path.join(dllDir, "steam_settings");
    fs.mkdirSync(steamSettings, { recursive: true });
    fs.writeFileSync(
      path.join(steamSettings, "steam_appid.txt"),
      appId,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(steamSettings, "configs.user.ini"),
      `[user::saves]\nlocal_save_path=./drop-goldberg\n`,
      "utf-8",
    );
  } else {
    const ok = await swapDllAndWriteSettings(
      {
        dllDir,
        dllName,
        appId,
        backupSuffix: STEAM_DRM_BACKUP_SUFFIX,
      },
      logger,
    );
    if (!ok) {
      return {
        success: false,
        message: `Failed to swap ${dllName} with GBE DLL — check server logs`,
        backupCreated: false,
      };
    }
  }

  try {
    const { setupGoldberg } = await import("./goldberg");
    await setupGoldberg(gameId, dllDir);
  } catch (e) {
    logger.warn(`setupGoldberg follow-up failed (non-critical): ${e}`);
  }

  // ── Regenerate manifest so checksums match the new DLL ─────────────────
  const { libraryManager } = await import("./library");
  const regenOk = await libraryManager.regenerateManifestForLatestVersion(
    gameId,
    logger,
  );
  if (!regenOk) {
    logger.warn(
      `Manifest regen did not complete — downloads may fail checksum validation until re-imported`,
    );
  }

  const action = alreadyUpgraded ? "Refreshed" : "Swapped";
  return {
    success: true,
    message: `${action} ${dllName} → GBE (AppID ${appId})${regenOk ? ", manifest regenerated" : " — manifest regen FAILED"}`,
    backupCreated: !alreadyUpgraded,
  };
}

/**
 * Reverts a GBE upgrade by restoring whichever backup is present
 * (`.sse_backup` from an SSE upgrade, `.steam_backup` from a Steam
 * DRM upgrade) and removing `steam_settings/`.
 *
 * Caller is responsible for regenerating the droplet manifest if
 * the revert is expected to persist — this function only touches
 * the on-disk files.
 */
export function revertToSse(
  dllDir: string,
  dllName: string,
): { success: boolean; message: string } {
  try {
    const dllPath = path.join(dllDir, dllName);
    const sseIniPath = path.join(dllDir, "steam_emu.ini");

    // Try each backup suffix in turn — SSE path first, then Steam DRM.
    for (const suffix of [BACKUP_SUFFIX, STEAM_DRM_BACKUP_SUFFIX]) {
      const dllBackup = dllPath + suffix;
      if (fs.existsSync(dllBackup)) {
        fs.copyFileSync(dllBackup, dllPath);
        fs.unlinkSync(dllBackup);
      }
      const iniBackup = sseIniPath + suffix;
      if (fs.existsSync(iniBackup)) {
        fs.copyFileSync(iniBackup, sseIniPath);
        fs.unlinkSync(iniBackup);
      }
    }

    const steamSettings = path.join(dllDir, "steam_settings");
    if (fs.existsSync(steamSettings)) {
      fs.rmSync(steamSettings, { recursive: true, force: true });
    }

    return {
      success: true,
      message: "Reverted GBE upgrade successfully",
    };
  } catch (e) {
    return {
      success: false,
      message: `Revert failed: ${e}`,
    };
  }
}
