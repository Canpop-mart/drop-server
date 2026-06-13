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
import { createHash } from "crypto";
import { logger } from "~/server/internal/logging";

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
