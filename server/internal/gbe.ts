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
      // Defensive (step 8): never restore a backup that is itself a GBE build —
      // that means a prior swap overwrote the real original, and restoring would
      // be a pointless GBE-over-GBE. Leave such a backup in place.
      if (fs.existsSync(dllBackup) && !isGbeDll(dllBackup)) {
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

// ── GBE swap (import-time DLL replacement, Plan B: GBE everywhere) ─────────
//
// At import every eligible game's steam_api DLL is replaced with the bundled
// gbe_fork build so the game gets achievements + Goldberg LAN/ZeroTier
// matchmaking (proven cross-internet on Castle Crashers). Binaries are BUNDLED
// (not downloaded) for reproducibility + offline NAS builds.

/** Architecture variants of the bundled gbe_fork binary. */
export type GbeArch = "win64" | "win32" | "linux";

/** Maps a steam_api DLL filename (lowercase) → its gbe_fork architecture. */
const DLL_TO_ARCH: Record<string, GbeArch> = {
  "steam_api64.dll": "win64",
  "steam_api.dll": "win32",
  "libsteam_api.so": "linux",
};

/**
 * Root of the bundled gbe_fork binaries. Docker sets GBE_BUNDLE=/app/gbe-bin;
 * in dev it resolves to the repo's gbe-bin/ relative to the server cwd.
 */
function gbeBundleDir(): string {
  return process.env.GBE_BUNDLE || path.resolve("gbe-bin");
}

/** Path to the bundled GBE DLL for an arch, or undefined if not bundled. */
function bundledGbeDll(arch: GbeArch): string | undefined {
  const name =
    arch === "win64"
      ? "steam_api64.dll"
      : arch === "win32"
        ? "steam_api.dll"
        : "libsteam_api.so";
  const p = path.join(gbeBundleDir(), arch, name);
  return fs.existsSync(p) ? p : undefined;
}

/**
 * True if a bundled GBE binary exists for this DLL's architecture. Lets callers
 * (e.g. the backfill task) avoid re-importing a game whose only steam_api DLL
 * has no bundled replacement — that would publish a byte-identical new version.
 */
export function hasBundledGbeForDll(dllName: string): boolean {
  const arch = DLL_TO_ARCH[dllName.toLowerCase()];
  return arch ? bundledGbeDll(arch) !== undefined : false;
}

/**
 * gbe_fork networking config (configs.main.ini). Pins listen_port to 47584
 * (every peer MUST share it or LAN/ZeroTier discovery silently fails) and
 * keeps networking + lobbies on. Validated cross-internet over ZeroTier.
 */
const GBE_CONFIGS_MAIN_INI =
  "[main::connectivity]\n" +
  "# Emulator listen port — identical on every player or peers never find each other.\n" +
  "listen_port=47584\n" +
  "# 0 = steam networking ON (lobbies + p2p) — required for co-op.\n" +
  "disable_networking=0\n" +
  "# 0 = behave as if steam is online.\n" +
  "offline=0\n";

interface SwapOptions {
  dllDir: string;
  dllName: string;
  appId: string;
  backupSuffix: string;
  /** Optional SSE-derived Steamworks interface versions → steam_interfaces.txt. */
  interfaces?: Map<string, string>;
  /** Optional SSE-derived DLC map (id → name) → dlc.txt. */
  dlcs?: Map<string, string>;
}

/**
 * Replace one steam_api DLL with the bundled GBE build and write the
 * steam_settings the emulator needs (appid + networking + save path, plus
 * optional interfaces/dlc). Idempotent: backs up the original only once.
 * Returns false (with a loud warn — never silent) if no bundled binary exists
 * for the arch, so a missing bundle is diagnosable, not a phantom no-op.
 */
function swapDllAndWriteSettings(
  opts: SwapOptions,
  log: { info: (m: string) => void; warn: (m: string) => void },
): boolean {
  const arch = DLL_TO_ARCH[opts.dllName.toLowerCase()];
  if (!arch) {
    log.warn(`[GBE] Unknown DLL arch: ${opts.dllName}, skipping swap`);
    return false;
  }

  const gbeDllPath = bundledGbeDll(arch);
  if (!gbeDllPath) {
    log.warn(
      `[GBE] No bundled GBE binary for ${arch} (looked in ${gbeBundleDir()}); ` +
        `skipping swap of ${opts.dllName}`,
    );
    return false;
  }

  const dllPath = path.join(opts.dllDir, opts.dllName);
  const backupPath = dllPath + opts.backupSuffix;

  if (fs.existsSync(dllPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(dllPath, backupPath);
    log.info(
      `[GBE] Backed up ${opts.dllName} → ${opts.dllName}${opts.backupSuffix}`,
    );
  }

  fs.copyFileSync(gbeDllPath, dllPath);
  log.info(`[GBE] Replaced ${opts.dllName} with bundled GBE (${arch})`);

  const steamSettings = path.join(opts.dllDir, "steam_settings");
  fs.mkdirSync(steamSettings, { recursive: true });

  fs.writeFileSync(
    path.join(steamSettings, "steam_appid.txt"),
    opts.appId,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(steamSettings, "configs.main.ini"),
    GBE_CONFIGS_MAIN_INI,
    "utf-8",
  );
  // NOTE: configs.user.ini (local_save_path + account_name) is deliberately NOT
  // written here. The client writes it at launch with an ABSOLUTE DLL-anchored
  // save path (configure_goldberg). If the server shipped it, that file would be
  // in the manifest, and the client's launch-time rewrite would make the on-disk
  // bytes diverge from the manifest checksum — a later validate()/repair would
  // then demote the game to PartiallyInstalled. Keeping it client-owned (and out
  // of the manifest) avoids that.

  if (opts.interfaces && opts.interfaces.size > 0) {
    fs.writeFileSync(
      path.join(steamSettings, "steam_interfaces.txt"),
      Array.from(opts.interfaces.values()).join("\n") + "\n",
      "utf-8",
    );
  }
  if (opts.dlcs && opts.dlcs.size > 0) {
    fs.writeFileSync(
      path.join(steamSettings, "dlc.txt"),
      Array.from(opts.dlcs.entries())
        .map(([id, n]) => `${id}=${n}`)
        .join("\n") + "\n",
      "utf-8",
    );
  }

  return true;
}

/** Anti-cheat marker files Goldberg cannot satisfy — never swap these games. */
const ANTI_CHEAT_MARKERS: ReadonlySet<string> = new Set([
  "easyanticheat.exe",
  "easyanticheat_eos.dll",
  "easyanticheat_x64.dll",
  "eaclauncher.exe",
  "start_protected_game.exe",
  "beservice.exe",
  "beservice_x64.exe",
  "beclient.dll",
  "beclient_x64.dll",
  "belauncher.exe",
]);

/**
 * Returns the anti-cheat marker filename if EAC/BattlEye is present anywhere in
 * the tree (bounded depth), else null. Goldberg can't satisfy these, so the
 * swap is skipped + flagged rather than bricking the game.
 */
export function detectAntiCheat(rootDir: string): string | null {
  return detectAntiCheatRecursive(rootDir, 0, STEAM_API_SCAN_DEPTH);
}

function detectAntiCheatRecursive(
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
    if (entry.isFile() && ANTI_CHEAT_MARKERS.has(entry.name.toLowerCase())) {
      return entry.name;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = detectAntiCheatRecursive(
      path.join(dir, entry.name),
      depth + 1,
      maxDepth,
    );
    if (found) return found;
  }
  return null;
}

/** Enumerate EVERY steam_api DLL in the tree (multi-arch games ship 32+64). */
export function findAllSteamApiDlls(
  rootDir: string,
): { dllDir: string; dllName: string }[] {
  const out: { dllDir: string; dllName: string }[] = [];
  collectSteamApiDlls(rootDir, 0, STEAM_API_SCAN_DEPTH, out);
  return out;
}

function collectSteamApiDlls(
  dir: string,
  depth: number,
  maxDepth: number,
  out: { dllDir: string; dllName: string }[],
): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && STEAM_API_DLLS.includes(entry.name.toLowerCase())) {
      out.push({ dllDir: dir, dllName: entry.name });
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      collectSteamApiDlls(path.join(dir, entry.name), depth + 1, maxDepth, out);
    }
  }
}

/** Result of `ensureGbeDll`. */
export interface EnsureGbeResult {
  swapped: boolean;
  alreadyGbe: boolean;
  skipped: boolean;
  identification?: SteamApiDllIdentification;
  reason?: string;
}

/**
 * Plan B swap-toward-GBE policy for a single steam_api DLL:
 *   - gbe         → already swapped, skip.
 *   - valve       → swap (original backed up as <dll>.steam_backup).
 *   - unknown     → swap (we want GBE everywhere; original is backed up).
 *   - known-crack → skip. OnlineFix/CODEX/Cream/… are left in place: removing a
 *                   loader crack safely means also stripping its proxy loader
 *                   DLL (winmm/dnet/version/…), which needs per-crack detection +
 *                   Deck verification (the dedicated OnlineFix-removal step).
 *                   setupGoldberg's directory loader guard skips most of these
 *                   before they reach here; this per-DLL skip covers a
 *                   signature-only crack with no loader sibling file.
 *   - missing     → error.
 *
 * The directory-level anti-cheat + loader-crack guards in setupGoldberg run
 * BEFORE this. This acts per-DLL and is idempotent.
 */
export function ensureGbeDll(
  dllDir: string,
  dllName: string,
  appId: string,
  log: { info: (m: string) => void; warn: (m: string) => void },
): EnsureGbeResult {
  const dllPath = path.join(dllDir, dllName);
  if (!fs.existsSync(dllPath)) {
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: false,
      reason: "DLL not found",
    };
  }

  const ident = identifySteamApiDll(dllPath);
  if (ident.kind === "gbe") {
    log.info(`[GBE] ${dllName} is already GBE — skipping.`);
    return {
      swapped: false,
      alreadyGbe: true,
      skipped: false,
      identification: ident,
    };
  }
  if (ident.kind === "missing") {
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: false,
      identification: ident,
      reason: "DLL unreadable",
    };
  }
  if (ident.kind === "known-crack") {
    log.info(
      `[GBE] ${dllName} is a known crack (${ident.crackName ?? "?"}) — ` +
        `leaving in place (OnlineFix removal is a separate, Deck-verified step).`,
    );
    return {
      swapped: false,
      alreadyGbe: false,
      skipped: true,
      identification: ident,
      reason: `known crack (${ident.crackName ?? "unknown"}) left in place`,
    };
  }

  // valve / unknown → swap under Plan B (original backed up).
  const swapped = swapDllAndWriteSettings(
    { dllDir, dllName, appId, backupSuffix: STEAM_DRM_BACKUP_SUFFIX },
    log,
  );
  return {
    swapped,
    alreadyGbe: false,
    skipped: !swapped,
    identification: ident,
    reason: swapped ? undefined : "no bundled GBE binary for this arch",
  };
}

/**
 * NOT YET WIRED — staged for the dedicated OnlineFix-removal step. It is
 * INCOMPLETE on its own: OnlineFix loads via a PROXY DLL (winmm/dnet/version/
 * dinput8) that LoadLibrary's OnlineFix64.dll, and that proxy is NOT in
 * CRACK_LOADER_MARKER_FILES — moving OnlineFix64.dll while leaving the proxy can
 * brick the game. Before wiring this, add proxy detection (parse dlllist.txt /
 * fingerprint candidate proxy DLLs for a crack signature) and verify on a real
 * OnlineFix game on the Steam Deck.
 *
 * Plan B OnlineFix removal: move a crack's loader sibling files (the
 * CRACK_LOADER_MARKER_FILES set — OnlineFix64.dll, OnlineFix.ini, dlllist.txt,
 * cream_api.ini, …) OUT of the version dir into `backupDir`, preserving relative
 * paths. Called after a known-crack's steam_api DLL has been swapped to GBE:
 * those loader files are the multiplayer glue that fights GBE if left in place,
 * and the manifest scan (which has no exclusion filter) would otherwise ship
 * them to every client. Moving them out of the tree means droplet never hashes
 * them and the client reconcile-sweep clears them from existing installs, while
 * a recovery copy stays on the server (outside any library) for rollback.
 *
 * Returns the count moved. Best-effort: a file that can't be moved is left in
 * place and logged, never deleted.
 */
export function stripCrackLoaderSiblings(
  rootDir: string,
  backupDir: string,
  log: { info: (m: string) => void; warn: (m: string) => void },
): number {
  const matches: string[] = [];
  collectCrackLoaderSiblings(rootDir, 0, STEAM_API_SCAN_DEPTH, matches);

  let moved = 0;
  for (const filePath of matches) {
    const rel = path.relative(rootDir, filePath);
    const dest = path.join(backupDir, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(filePath, dest);
      moved++;
      log.info(`[GBE] Moved loader file ${rel} -> ${dest}`);
    } catch {
      // rename fails across devices/mounts — fall back to copy + unlink.
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filePath, dest);
        fs.unlinkSync(filePath);
        moved++;
        log.info(`[GBE] Moved (copy) loader file ${rel} -> ${dest}`);
      } catch (e) {
        log.warn(`[GBE] Could not move loader file ${rel}: ${e}`);
      }
    }
  }
  return moved;
}

function collectCrackLoaderSiblings(
  dir: string,
  depth: number,
  maxDepth: number,
  out: string[],
): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.isFile() &&
      CRACK_LOADER_MARKER_FILES.has(entry.name.toLowerCase())
    ) {
      out.push(path.join(dir, entry.name));
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      collectCrackLoaderSiblings(
        path.join(dir, entry.name),
        depth + 1,
        maxDepth,
        out,
      );
    }
  }
}
