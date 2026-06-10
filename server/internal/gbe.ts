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
import { createHash } from "crypto";
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
 * Minimal logger shape used by the download / extract helpers. Defaults
 * to a thin wrapper over the global server logger when nothing is
 * passed — the version-import task path always supplies its own task
 * logger so the messages show up in the live progress feed.
 */
export type SwapLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

/**
 * Default fallback logger used when a helper is called outside of a
 * task context (e.g. one-off admin script). Routes through the pino
 * server logger so output still lands in the application log.
 */
function fallbackLogger(): SwapLogger {
  return {
    info: (msg) => logger.info(msg),
    warn: (msg) => logger.warn(msg),
  };
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
export async function fetchLatestRelease(
  log: SwapLogger = fallbackLogger(),
): Promise<GhRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GBE_REPO}/releases/latest`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      log.warn(
        `[GBE] GitHub API returned ${res.status} fetching latest release`,
      );
      return null;
    }
    return (await res.json()) as GhRelease;
  } catch (e) {
    log.warn(`[GBE] Failed to fetch latest release: ${e}`);
    return null;
  }
}

/**
 * Downloads a file from a URL to a local path.
 */
async function downloadFile(
  url: string,
  dest: string,
  log: SwapLogger,
): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) {
      log.warn(`[GBE] Download failed: ${res.status} from ${url}`);
      return false;
    }
    const fileStream = createWriteStream(dest);
    // @ts-expect-error - ReadableStream from fetch vs Node stream
    await pipeline(res.body, fileStream);
    return true;
  } catch (e) {
    log.warn(`[GBE] Download error for ${url}: ${e}`);
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
export async function downloadGbeDlls(
  log: SwapLogger = fallbackLogger(),
): Promise<string | null> {
  const release = await fetchLatestRelease(log);
  if (!release) return null;

  log.info(
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
    log.info(`[GBE] Downloading ${asset.name} (${asset.size} bytes)...`);

    if (!(await downloadFile(asset.browser_download_url, tmpPath, log))) {
      continue;
    }

    try {
      await extractArchiveDlls(tmpPath, asset.name, log);
      downloaded = true;
    } catch (e) {
      log.warn(`[GBE] Failed to extract ${asset.name}: ${e}`);
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
    log.warn(
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
  log: SwapLogger,
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

    log.info(`[GBE] Extracted ${fileName}, scanning for DLLs...`);
    findAndCacheDlls(tmpDir, log);
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
function findAndCacheDlls(dir: string, log: SwapLogger): void {
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
    log.info(`[GBE] Cached ${dllName} → ${dest}`);
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
 * Max directory depth for the steam_api DLL / DRM-marker scans. Unreal
 * Engine games bury steam_api64.dll deep, e.g.
 *   Engine/Binaries/ThirdParty/Steamworks/Steamv157/Win64/steam_api64.dll
 * which is 6 levels below the version root. The previous limit of 5 stopped
 * one directory short, so the DLL was never found, setupGoldberg fell back to
 * writing steam_settings/ + the achievement schema at the version ROOT, and
 * the buried emulator booted schema-less and recorded no achievements.
 * 8 covers UE's layout with headroom. (See LEGO Batman / Black Myth: Wukong.)
 */
const STEAM_API_SCAN_DEPTH = 8;

/**
 * Recursively finds the directory containing a Steam API DLL within a
 * game's version directory. Returns the directory path and the DLL name.
 */
export function findSteamApiDll(
  rootDir: string,
): { dllDir: string; dllName: string } | null {
  return findSteamApiDllRecursive(rootDir, 0, STEAM_API_SCAN_DEPTH);
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
 * Filenames that positively flag a pre-applied loader/wrapper crack whose OWN
 * steam_api[64].dll fingerprints as vanilla Valve. OnlineFix (and CreamAPI,
 * etc.) ship a steam_api DLL that re-exports the Steamworks interface strings,
 * so `identifySteamApiDll` — which only reads the DLL itself — classifies it as
 * Valve and would swap it. The real crack marker lives in a SIBLING file
 * elsewhere in the install (`OnlineFix64.dll`, `OnlineFix.ini`, the proxy
 * loader's `dlllist.txt`, …). If one is present, swapping the steam_api DLL for
 * GBE bricks the crack's multiplayer (OnlineFix uses the SpaceWar AppID for its
 * lobby), so the swap must be suppressed. Lowercased for case-insensitive match.
 */
const CRACK_LOADER_MARKER_FILES: ReadonlySet<string> = new Set([
  "onlinefix.ini",
  "onlinefix64.dll",
  "onlinefix.url",
  "dlllist.txt",
  "cream_api.ini",
  "creamapi.loader.config.ini",
]);

/**
 * Returns the marker filename if `rootDir` (recursively, bounded depth)
 * contains a crack-loader sibling file, else null. Drives the swap-suppression
 * guard in `ensureGbeDll` for loader cracks whose steam_api DLL looks Valve.
 */
export function detectCrackLoader(rootDir: string): string | null {
  return detectCrackLoaderRecursive(rootDir, 0, STEAM_API_SCAN_DEPTH);
}

function detectCrackLoaderRecursive(
  dir: string,
  depth: number,
  maxDepth: number,
): string | null {
  if (depth > maxDepth) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (
      entry.isFile() &&
      CRACK_LOADER_MARKER_FILES.has(entry.name.toLowerCase())
    ) {
      return entry.name;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = detectCrackLoaderRecursive(
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
  return hasSteamDrmMarkerRecursive(rootDir, 0, STEAM_API_SCAN_DEPTH);
}

// ── DLL fingerprinting (positive identification) ─────────────────────────
//
// The swap path used to be **opt-out** — if the DLL didn't contain a GBE
// signature ("Goldberg" / "Mr_Goldberg" / "gbe_fork") it was assumed to be
// a vanilla Valve Steamworks build and got swapped. That destroyed
// pre-applied OnlineFix, CODEX, EMPRESS, CreamAPI, and custom Goldberg
// fork DLLs on every import, leaving the working crack behind as
// `<dll>.steam_backup`.
//
// The new model is **opt-in for swap**:
//   1. Try to positively identify a vanilla Valve Steamworks DLL.
//   2. Try to positively identify a known crack DLL.
//   3. If neither matches, leave the file alone.

/**
 * Returns true when the DLL contains ASCII signatures characteristic of
 * a Goldberg / gbe_fork release binary.
 *
 * Used downstream of the new opt-in swap logic — purely a "skip, this is
 * already the swap target" check. **Never** rely on this as a negative
 * proof of "this must be Valve's DLL".
 */
export function isGbeDll(dllPath: string): boolean {
  const buf = readDllForFingerprint(dllPath);
  if (!buf) return false;
  return containsAnyAscii(buf, GBE_SIGNATURES);
}

/** ASCII signatures present in gbe_fork / Goldberg releases. */
const GBE_SIGNATURES = ["Goldberg", "Mr_Goldberg", "gbe_fork"];

/**
 * ASCII signatures present in Valve's official steam_api[64].dll. Each
 * one alone is weak (third-party DLLs frequently reuse Steamworks
 * interface names so games stay binary-compatible), so callers should
 * require **at least two** before treating a DLL as vanilla.
 *
 * The interface-version strings are exported by the real DLL at known
 * offsets and almost always appear together in shipped Valve binaries.
 * "Copyright (c) Valve Corporation" is the strongest single signal.
 */
const VALVE_SIGNATURES = [
  "Copyright (c) Valve Corporation",
  "Valve Corporation",
  // Stable Steamworks interface version strings shipped by vanilla DLLs.
  // Bump these list-wise if Valve rotates an interface.
  "SteamUser019",
  "SteamUser020",
  "SteamUser021",
  "SteamApps008",
  "STEAMAPPS_INTERFACE_VERSION008",
  "SteamUtils009",
  "SteamUtils010",
  "STEAMUTILS_INTERFACE_VERSION009",
  "SteamFriends017",
  "SteamFriends018",
  "STEAMFRIENDS_INTERFACE_VERSION017",
];

/**
 * ASCII signatures present in well-known crack / wrapper DLLs.
 *
 * Each entry is `[label, signatures[]]` — when ANY signature matches the
 * DLL is treated as a known crack and the auto-swap is suppressed loudly.
 *
 * Be conservative with single-word entries (e.g. "CODEX", "RUNE",
 * "SKIDROW") — they can collide with legitimate strings in unrelated
 * binaries. Pair them with at least one other crack-specific marker
 * before adding here, OR use a more specific phrase from the crack's
 * banner/credit string.
 */
const CRACK_SIGNATURES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["OnlineFix", ["OnlineFix", "OnlineFix64", "Online-Fix.me"]],
  ["FCKDRM", ["FCKDRM"]],
  ["FreeAllAccess", ["FreeAllAccess"]],
  ["CODEX", ["CODEX presents", "Steam_API_CODEX"]],
  ["EMPRESS", ["EMPRESS", "empress.coffee"]],
  ["CreamAPI", ["CreamAPI", "CREAMAPI", "cream_api.ini"]],
  ["SmartSteamEmu", ["SmartSteamEmu", "SmartSteamEmulator"]],
  ["SmartSteamLoader", ["SmartSteamLoader"]],
  ["Greenluma", ["Greenluma", "GreenLuma"]],
  ["ChromeOSAuthd", ["ChromeOSAuthd"]],
  ["RUNE", ["RUNE presents", "rune.team"]],
  ["SKIDROW", ["SKIDROW presents", "skidrow.cracked"]],
  ["RLD!", ["RELOADED presents", "RLD!"]],
];

/**
 * Optional allowlist of SHA-256 hashes that positively identify a DLL as
 * vanilla Valve Steamworks. Empty by default — populate as you confirm
 * known-good builds in the wild. A single hash hit is sufficient to
 * authorise the swap (in contrast to the signature-pair requirement).
 */
const VALVE_SHA256_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // e.g. "9f3c6e92a4...": "steam_api64.dll @ Steamworks SDK v1.61",
]);

/** Result of `identifySteamApiDll`. */
export type SteamApiDllKind =
  | "valve"
  | "gbe"
  | "known-crack"
  | "unknown"
  | "missing";

export interface SteamApiDllIdentification {
  /** Coarse bucket — drives the swap decision. */
  kind: SteamApiDllKind;
  /** Human-readable description of what we matched. */
  fingerprint: string;
  /** Specific crack label if `kind === "known-crack"`. */
  crackName?: string;
  /** SHA-256 of the DLL, when the file was readable. */
  sha256?: string;
}

/**
 * Reads `dllPath` and returns a positive identification of what's in it.
 *
 * Priority order (first match wins):
 *   1. SHA-256 in the Valve allowlist → vanilla Valve.
 *   2. GBE / Goldberg signatures → already swapped, skip.
 *   3. Any known-crack signature → leave alone, never swap.
 *   4. Two or more Valve signatures → vanilla Valve, OK to swap.
 *   5. Otherwise → unknown, don't swap (conservative default).
 *
 * Reading the whole DLL into memory is fine — typical steam_api files
 * are 300 KB to 1 MB.
 */
export function identifySteamApiDll(
  dllPath: string,
): SteamApiDllIdentification {
  const buf = readDllForFingerprint(dllPath);
  if (!buf) {
    return { kind: "missing", fingerprint: "could not read DLL" };
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  if (VALVE_SHA256_ALLOWLIST.has(sha256)) {
    return {
      kind: "valve",
      fingerprint: `Valve allowlist sha256=${sha256.slice(0, 12)}…`,
      sha256,
    };
  }

  // GBE check first — once swapped, the file ALSO contains Steamworks
  // interface strings (gbe re-exports them), so without this check
  // already-swapped DLLs would be re-classified as Valve and re-swapped.
  if (containsAnyAscii(buf, GBE_SIGNATURES)) {
    return {
      kind: "gbe",
      fingerprint: "GBE / Goldberg signature present",
      sha256,
    };
  }

  for (const [label, sigs] of CRACK_SIGNATURES) {
    if (containsAnyAscii(buf, sigs)) {
      return {
        kind: "known-crack",
        fingerprint: `${label} signature present`,
        crackName: label,
        sha256,
      };
    }
  }

  const valveHits = countAsciiHits(buf, VALVE_SIGNATURES);
  if (valveHits >= 2) {
    return {
      kind: "valve",
      fingerprint: `${valveHits} Valve signature(s) matched`,
      sha256,
    };
  }

  if (valveHits === 1) {
    return {
      kind: "unknown",
      fingerprint:
        `only ${valveHits} Valve signature matched (need >=2 for positive ID); ` +
        `not GBE, not a known crack`,
      sha256,
    };
  }

  return {
    kind: "unknown",
    fingerprint:
      "no Valve, GBE, or known-crack signatures found — custom or unknown build",
    sha256,
  };
}

function readDllForFingerprint(dllPath: string): Buffer | null {
  try {
    return fs.readFileSync(dllPath);
  } catch {
    return null;
  }
}

function containsAnyAscii(buf: Buffer, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (buf.includes(Buffer.from(needle, "utf-8"))) return true;
  }
  return false;
}

function countAsciiHits(buf: Buffer, needles: readonly string[]): number {
  let n = 0;
  for (const needle of needles) {
    if (buf.includes(Buffer.from(needle, "utf-8"))) n++;
  }
  return n;
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
    const tag = await downloadGbeDlls(logger);
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

/** Result of `ensureGbeDll`. */
export interface EnsureGbeResult {
  /** True iff a real swap happened on disk. */
  swapped: boolean;
  /** True iff the DLL was already a GBE build. */
  alreadyGbe: boolean;
  /**
   * True iff we deliberately skipped the swap because the DLL was
   * identified as something we must not overwrite (a known crack or
   * an unknown build that wasn't positively identified as Valve).
   */
  skipped: boolean;
  /** Identification of the on-disk DLL when we read it. */
  identification?: SteamApiDllIdentification;
  /** Human-readable failure message when `error` is set. */
  error?: string;
}

export interface EnsureGbeOptions {
  /**
   * Bypass detection and force the swap to run even for known-crack /
   * unknown DLLs. Reserved for admin-triggered escape hatch — never set
   * this from `setupGoldberg`.
   */
  forceGbeSwap?: boolean;
  /**
   * Game install root (version directory). When set, the swap is suppressed if
   * a loader/wrapper crack (OnlineFix, CreamAPI, …) is detected anywhere in the
   * tree — even when the steam_api DLL itself fingerprints as Valve. These
   * cracks ship a steam_api DLL that re-exports the Steamworks interface
   * strings, so the per-DLL fingerprint alone can't distinguish them from
   * vanilla Valve; their real marker is a sibling file (e.g. `OnlineFix64.dll`).
   */
  installRoot?: string;
}

/**
 * Ensures the game's steam_api DLL is a GBE build — the canonical
 * idempotent entry point for setupGoldberg & the readiness scanner.
 *
 * Swap decision (opt-in, requires positive identification):
 *   - `gbe`         → already swapped, nothing to do.
 *   - `valve`       → swap. Original preserved as `<dll>.steam_backup`.
 *   - `known-crack` → SKIP loudly. Refuses to overwrite OnlineFix etc.
 *   - `unknown`     → SKIP loudly. Refuses to overwrite a possibly-
 *                     working crack. Override with `forceGbeSwap: true`.
 *   - `missing`     → error.
 *
 * Safe to call repeatedly: only hits disk when a real swap is needed.
 *
 * Callers carrying SSE-specific metadata (interfaces / DLCs) should
 * call `swapDllAndWriteSettings` directly so that metadata gets
 * persisted to `steam_interfaces.txt` / `dlc.txt`.
 */
export async function ensureGbeDll(
  dllDir: string,
  dllName: string,
  appId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  options?: EnsureGbeOptions,
): Promise<EnsureGbeResult> {
  const dllPath = path.join(dllDir, dllName);

  if (!fs.existsSync(dllPath)) {
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: false,
      error: "DLL not found",
    };
  }

  const ident = identifySteamApiDll(dllPath);

  if (ident.kind === "gbe") {
    logger.info(
      `[GBE] ${dllName} (sha256=${ident.sha256?.slice(0, 12)}…) ` +
        `is already a GBE build (${ident.fingerprint}). Skipping swap.`,
    );
    return {
      swapped: false,
      alreadyGbe: true,
      skipped: false,
      identification: ident,
    };
  }

  if (ident.kind === "known-crack" && !options?.forceGbeSwap) {
    logger.warn(
      `[GBE] ${dllName} (sha256=${ident.sha256?.slice(0, 12)}…) ` +
        `detected as ${ident.crackName ?? "known crack"} (${ident.fingerprint}). ` +
        `Skipping GBE swap — refusing to overwrite a working crack. ` +
        `Pass forceGbeSwap: true if you really want to replace it.`,
    );
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: true,
      identification: ident,
    };
  }

  if (ident.kind === "unknown" && !options?.forceGbeSwap) {
    logger.warn(
      `[GBE] ${dllName} (sha256=${ident.sha256?.slice(0, 12)}…) — ` +
        `could not positively identify DLL as Valve; leaving in place. ` +
        `Fingerprint: ${ident.fingerprint}. ` +
        `Run with forceGbeSwap: true to override (e.g. via per-game admin toggle).`,
    );
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: true,
      identification: ident,
    };
  }

  // A loader/wrapper crack (OnlineFix, CreamAPI, …) ships a steam_api DLL that
  // re-exports the Steamworks interface strings, so it fingerprinted as Valve
  // above — but its real marker is a SIBLING file elsewhere in the install.
  // When the caller gave us the install root, scan it: if a loader is present,
  // refuse the swap, or we'd brick the crack's multiplayer (e.g. OnlineFix's
  // SpaceWar lobby). The steam_settings/ + achievement scaffolding is still
  // written by setupGoldberg, so achievements keep recording via the crack's
  // own emulator.
  if (
    ident.kind === "valve" &&
    !options?.forceGbeSwap &&
    options?.installRoot
  ) {
    const loaderMarker = detectCrackLoader(options.installRoot);
    if (loaderMarker) {
      logger.warn(
        `[GBE] ${dllName} fingerprints as Valve, but a crack loader ` +
          `(${loaderMarker}) is present in the install tree — skipping GBE swap ` +
          `to preserve the pre-applied crack's multiplayer/DRM. ` +
          `Pass forceGbeSwap: true to override.`,
      );
      return {
        swapped: false,
        alreadyGbe: false,
        skipped: true,
        identification: {
          ...ident,
          kind: "known-crack",
          crackName: `loader:${loaderMarker}`,
          fingerprint: `Valve-looking steam_api DLL, but crack loader present (${loaderMarker})`,
        },
      };
    }
  }

  // At this point: kind === "valve", OR forceGbeSwap === true.
  const forced = ident.kind !== "valve" && options?.forceGbeSwap;
  if (forced) {
    logger.warn(
      `[GBE] ${dllName} forceGbeSwap is set — proceeding with swap despite ` +
        `non-Valve fingerprint (${ident.fingerprint}). Original preserved as ` +
        `${dllName}${STEAM_DRM_BACKUP_SUFFIX}.`,
    );
  } else {
    logger.info(
      `[GBE] ${dllName} identified as vanilla Valve Steamworks (${ident.fingerprint}). ` +
        `Swapping to GBE; original preserved as ${dllName}${STEAM_DRM_BACKUP_SUFFIX}.`,
    );
  }

  const ok = await swapDllAndWriteSettings(
    { dllDir, dllName, appId, backupSuffix: STEAM_DRM_BACKUP_SUFFIX },
    logger,
  );

  return ok
    ? {
        swapped: true,
        alreadyGbe: false,
        skipped: false,
        identification: ident,
      }
    : {
        swapped: false,
        alreadyGbe: false,
        skipped: false,
        identification: ident,
        error: "swap failed",
      };
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
    `[GBE] Game ${gameId}: Steam DRM markers found (AppID ${appId}); ` +
      `checking ${dllInfo.dllName} fingerprint before swap`,
  );

  // Defer the actual swap decision to ensureGbeDll, which only proceeds
  // for positively-identified Valve binaries and refuses to overwrite
  // OnlineFix / CODEX / EMPRESS / CreamAPI / unknown custom DLLs.
  const result = await ensureGbeDll(
    dllInfo.dllDir,
    dllInfo.dllName,
    appId,
    logger,
  );

  if (result.swapped) {
    logger.info(
      `[GBE] Auto-upgraded ${gameId} from Steam DRM to GBE (AppID ${appId})`,
    );
  } else if (result.alreadyGbe) {
    logger.info(
      `[GBE] Game ${gameId}: steam_api DLL is already GBE, no swap needed`,
    );
  } else if (result.skipped) {
    logger.warn(
      `[GBE] Game ${gameId}: skipped GBE swap to preserve pre-existing crack/unknown DLL ` +
        `(${result.identification?.fingerprint ?? "no fingerprint"})`,
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
    await setupGoldberg(gameId, dllDir, { logger });
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
  options?: { forceGbeSwap?: boolean },
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
    // Defer the swap to ensureGbeDll so it goes through the same opt-in
    // identification check as the auto path. Admins can pass
    // forceGbeSwap: true to override (e.g. for a custom Goldberg fork
    // that doesn't carry the standard signatures).
    const result = await ensureGbeDll(dllDir, dllName, appId, logger, {
      forceGbeSwap: options?.forceGbeSwap,
    });
    if (!result.swapped && !result.alreadyGbe) {
      const reason =
        result.error ??
        (result.skipped
          ? `swap skipped (${result.identification?.fingerprint ?? "unknown reason"}). ` +
            `Use the per-game admin override if this DLL really needs the swap.`
          : "unknown error");
      return {
        success: false,
        message: `Did not swap ${dllName}: ${reason}`,
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

/** Suffix used when stashing the GBE DLL aside during a backup restore. */
export const GBE_BACKUP_SUFFIX = ".gbe_backup";

/**
 * Result of `restoreSteamBackup` — one entry per file we touched (or
 * tried to touch) under a single steam_api DLL path.
 */
export interface RestoreSteamBackupResult {
  /** Path that we restored to (the original `<dll>` location). */
  dllPath: string;
  /** True if a backup was found and restored. */
  restored: boolean;
  /** Optional note (e.g. "no backup", "already restored", error text). */
  note?: string;
}

/**
 * Recursively walks `rootDir` looking for `*.steam_backup` files, and for
 * each one restores the original DLL in place, stashing the
 * currently-installed (presumably GBE) DLL aside as `<dll>.gbe_backup`
 * before doing the restore.
 *
 * Caller is responsible for regenerating the droplet manifest after a
 * successful restore — this function only touches files on disk.
 *
 * Idempotent — if no `.steam_backup` exists under `rootDir`, returns
 * an empty list.
 */
export function restoreSteamBackup(
  rootDir: string,
): RestoreSteamBackupResult[] {
  const results: RestoreSteamBackupResult[] = [];
  walkForSteamBackups(rootDir, 0, 8, results);
  return results;
}

function walkForSteamBackups(
  dir: string,
  depth: number,
  maxDepth: number,
  out: RestoreSteamBackupResult[],
): void {
  if (depth > maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(STEAM_DRM_BACKUP_SUFFIX)) continue;

    const backupPath = path.join(dir, entry.name);
    const originalName = entry.name.slice(
      0,
      entry.name.length - STEAM_DRM_BACKUP_SUFFIX.length,
    );
    const originalPath = path.join(dir, originalName);

    try {
      // Stash the current (likely GBE) DLL aside, but only if it's
      // not already a backup file — the user might have manually
      // re-applied the crack already.
      if (fs.existsSync(originalPath)) {
        const gbeBackupPath = originalPath + GBE_BACKUP_SUFFIX;
        if (fs.existsSync(gbeBackupPath)) {
          fs.unlinkSync(gbeBackupPath);
        }
        fs.renameSync(originalPath, gbeBackupPath);
      }

      // Promote the backup back to the original location. Use copyFileSync
      // + unlinkSync (instead of rename) so we keep both copies if the
      // unlink races — the user always ends up with the crack restored.
      fs.copyFileSync(backupPath, originalPath);
      fs.unlinkSync(backupPath);

      out.push({
        dllPath: originalPath,
        restored: true,
        note: `restored from ${entry.name}; current DLL moved to ${originalName}${GBE_BACKUP_SUFFIX}`,
      });
    } catch (e) {
      out.push({
        dllPath: originalPath,
        restored: false,
        note: `restore failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    walkForSteamBackups(path.join(dir, entry.name), depth + 1, maxDepth, out);
  }
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
