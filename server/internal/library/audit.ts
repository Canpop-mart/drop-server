/**
 * Library integrity audit.
 *
 * One read-only pass over the library that surfaces everything wrong between
 * the database and what's actually on disk. Consolidates what used to be three
 * separate tasks (scan:library-health, cleanup:library-orphans,
 * scan:launch-config-audit):
 *   - orphaned_version    — a GameVersion row whose folder is gone on disk;
 *   - unreadable_version  — the folder exists but is empty or can't be read
 *     into (stale mount / Synology ACL drift);
 *   - missing_launch_target / invalid_launch_target — a launch command that
 *     points at a file that doesn't exist, or isn't plausibly executable for
 *     its platform (Windows → .exe/.bat; Linux → ELF / .sh / .AppImage /
 *     .x86_64, NOT a data file like .bin/.pak; macOS → .app). Emulator
 *     launches point at a ROM/disc, so only their existence is checked;
 *   - missing_windows_launch — a playable (non-setup) version with no Windows
 *     launch (the common "Windows via Proton" case);
 *   - orphaned_folder     — a game folder on disk under a library with no Game
 *     row pointing at it (the inverse of orphaned_version, at game granularity).
 *
 * Report-only — it never mutates. Shared by the scan:library-integrity task
 * and the admin audit API/page.
 */
import fs from "fs";
import path from "path";
import prisma from "../db/database";
import { libraryManager } from ".";
import { Platform } from "~/prisma/client/enums";

export type LibraryAuditIssueType =
  | "orphaned_version"
  | "unreadable_version"
  | "missing_launch_target"
  | "invalid_launch_target"
  | "mistagged_linux_launch"
  | "missing_windows_launch"
  | "orphaned_folder";

export interface LibraryAuditIssue {
  type: LibraryAuditIssueType;
  /** Present for version-scoped issues; absent for orphaned_folder. */
  gameId?: string;
  gameName?: string;
  versionId?: string;
  versionName?: string;
  platform?: Platform;
  launchId?: string;
  launchName?: string;
  command?: string;
  /** orphaned_folder only — the library + on-disk folder with no DB row. */
  libraryName?: string;
  path?: string;
  detail: string;
}

export interface LibraryAuditResult {
  issues: LibraryAuditIssue[];
  summary: {
    versionsScanned: number;
    orphanedVersions: number;
    unreadableVersions: number;
    missingTargets: number;
    invalidTargets: number;
    missingWindowsLaunch: number;
    mistaggedLinuxLaunches: number;
    orphanedFolders: number;
  };
}

/** Extensions that are unambiguously NOT executables (data/content files). */
const DATA_FILE_EXTS: ReadonlySet<string> = new Set([
  ".bin",
  ".pak",
  ".uasset",
  ".umap",
  ".ucas",
  ".utoc",
  ".dat",
  ".bnk",
  ".bank",
  ".assets",
  ".ress",
  ".resource",
  ".dll",
  ".so",
  ".ini",
  ".cfg",
  ".txt",
  ".json",
  ".xml",
  ".png",
  ".jpg",
  ".wav",
  ".ogg",
  ".mp4",
]);

/** Linux launch extensions we accept without reading the file. */
const LINUX_EXEC_EXTS: ReadonlySet<string> = new Set([
  ".sh",
  ".appimage",
  ".x86_64",
  ".x86",
]);

/**
 * Files a ROM/disc launch should NEVER point at — documentation / metadata a
 * mis-detected import can grab as the "ROM". Emulator launches otherwise skip
 * the executable check (a ROM can be almost any extension), so this is how an
 * emulator launch pointing at LICENSE.md / README.txt still gets flagged.
 */
const NON_ROM_EXTS: ReadonlySet<string> = new Set([
  ".md",
  ".txt",
  ".nfo",
  ".url",
  ".html",
  ".htm",
  ".pdf",
  ".rtf",
  ".log",
]);
const NON_ROM_BASENAME =
  /^(license|readme|changelog|credits|copying|authors|notice)\b/i;

/** True if `rel` is obviously documentation/metadata, never a game ROM/disc. */
function isNonRomTarget(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  return NON_ROM_EXTS.has(path.extname(base)) || NON_ROM_BASENAME.test(base);
}

/** True if the first bytes of `fullPath` are the ELF magic (`\x7fELF`). */
function isElf(fullPath: string): boolean {
  try {
    const fd = fs.openSync(fullPath, "r");
    try {
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      return (
        buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46
      );
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** True if `fullPath` starts with a `#!` shebang (a script launcher). */
function isShebang(fullPath: string): boolean {
  try {
    const fd = fs.openSync(fullPath, "r");
    try {
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      return buf[0] === 0x23 && buf[1] === 0x21;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Recover the real on-disk path from a stored launch command.
 *
 * Import stores launch commands shell-escaped (shescape). The server runs on
 * Linux, so spaces / parens / etc. come back backslash-escaped — e.g.
 * `Super\ Mario\ Strikers\ \(USA\).iso` — while path separators stay forward
 * slashes. Testing that literal string against the filesystem fails even
 * though the file is right there, which flooded the audit with false "missing
 * target" hits on ROM + emulator launches. Strip any wrapping quotes, then
 * undo the backslash escapes (`\X` -> `X`) to recover the real path.
 */
function unescapeCommand(command: string): string {
  let s = command.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\(.)/g, "$1");
}

function resolveLaunchTarget(
  versionDir: string,
  command: string,
): { rel: string; fullPath: string; exists: boolean } {
  const rel = unescapeCommand(command);
  const fullPath = path.join(versionDir, rel);
  return { rel, fullPath, exists: fs.existsSync(fullPath) };
}

export async function auditLibrary(): Promise<LibraryAuditResult> {
  const issues: LibraryAuditIssue[] = [];

  // ── Pass 1: per-version integrity ──────────────────────────────────
  const versions = await prisma.gameVersion.findMany({
    select: {
      versionId: true,
      versionPath: true,
      displayName: true,
      onlySetup: true,
      game: {
        select: {
          id: true,
          mName: true,
          libraryId: true,
          libraryPath: true,
        },
      },
      launches: {
        select: {
          launchId: true,
          name: true,
          command: true,
          platform: true,
          emulatorId: true,
        },
      },
    },
  });

  for (const version of versions) {
    const game = version.game;
    const versionName =
      version.displayName ?? version.versionPath ?? version.versionId;
    if (!game.libraryId) continue;

    const provider = libraryManager.getLibrary(game.libraryId);
    const versionDir =
      provider && version.versionPath
        ? provider.resolveVersionDir(game.libraryPath, version.versionPath)
        : undefined;

    // 1. Orphaned version — DB row with no folder on disk.
    if (!versionDir) {
      issues.push({
        type: "orphaned_version",
        gameId: game.id,
        gameName: game.mName,
        versionId: version.versionId,
        versionName,
        detail: version.versionPath
          ? `No folder on disk for versionPath "${version.versionPath}"`
          : "Version has no versionPath",
      });
      continue;
    }

    // 2. Health — the folder exists; is it non-empty and readable? Catches
    //    stale mounts and Synology ACL drift (listable but not statable).
    try {
      const entries = fs.readdirSync(versionDir);
      if (entries.length === 0) {
        issues.push({
          type: "unreadable_version",
          gameId: game.id,
          gameName: game.mName,
          versionId: version.versionId,
          versionName,
          detail: "Version folder exists but is empty",
        });
        continue;
      }
      // Spot-check one entry — a dir can be listable while its contents are
      // owned by a uid the container can't read.
      fs.statSync(path.join(versionDir, entries[0]));
    } catch (e) {
      issues.push({
        type: "unreadable_version",
        gameId: game.id,
        gameName: game.mName,
        versionId: version.versionId,
        versionName,
        detail: `Version folder is unreadable: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // 3. Validate each launch target.
    for (const launch of version.launches) {
      const { rel, fullPath, exists } = resolveLaunchTarget(
        versionDir,
        launch.command,
      );

      if (!exists) {
        issues.push({
          type: "missing_launch_target",
          gameId: game.id,
          gameName: game.mName,
          versionId: version.versionId,
          versionName,
          platform: launch.platform,
          launchId: launch.launchId,
          launchName: launch.name,
          command: launch.command,
          detail: "Launch target does not exist on disk",
        });
        continue;
      }

      // Emulator launches point at a ROM/disc, not an executable, so we can't
      // demand a specific extension. But a ROM is never a documentation /
      // metadata file — a launch pointing at LICENSE.md / README.txt means the
      // import picker grabbed the wrong file, so still flag those. Everything
      // else with an emulatorId only needs to exist.
      if (launch.emulatorId) {
        if (isNonRomTarget(rel)) {
          issues.push({
            type: "invalid_launch_target",
            gameId: game.id,
            gameName: game.mName,
            versionId: version.versionId,
            versionName,
            platform: launch.platform,
            launchId: launch.launchId,
            launchName: launch.name,
            command: launch.command,
            detail: `Emulator launch points at a documentation/metadata file, not a ROM/disc (got "${rel}")`,
          });
        }
        continue;
      }

      const ext = path.extname(fullPath).toLowerCase();

      // A Windows binary tagged as a Linux launch. The client detects this at
      // launch (a .exe / PE binary triggers the NeedsCompat fallback) and runs
      // it through Proton, so it isn't broken, but the launch should be tagged
      // Windows. Surface it as a hygiene note rather than a launch failure.
      if (
        launch.platform === Platform.Linux &&
        (ext === ".exe" || ext === ".bat" || ext === ".cmd")
      ) {
        issues.push({
          type: "mistagged_linux_launch",
          gameId: game.id,
          gameName: game.mName,
          versionId: version.versionId,
          versionName,
          platform: launch.platform,
          launchId: launch.launchId,
          launchName: launch.name,
          command: launch.command,
          detail: `Windows binary on a Linux launch. Runs via Proton, but should be a Windows launch (got "${rel}").`,
        });
        continue;
      }

      let valid: boolean;
      let reason: string;

      if (launch.platform === Platform.Windows) {
        valid = ext === ".exe" || ext === ".bat" || ext === ".cmd";
        reason = `Windows launch should be an .exe/.bat (got "${rel}")`;
      } else if (launch.platform === Platform.Linux) {
        if (LINUX_EXEC_EXTS.has(ext)) {
          valid = true;
        } else if (DATA_FILE_EXTS.has(ext)) {
          valid = false;
        } else {
          // Unknown / no extension — accept only a real ELF binary or script.
          valid = isElf(fullPath) || isShebang(fullPath);
        }
        reason = `Linux launch should be an ELF binary or .sh/.AppImage/.x86_64 (got "${rel}")`;
      } else {
        // macOS — expect a .app bundle.
        valid = ext === ".app";
        reason = `macOS launch should be a .app (got "${rel}")`;
      }

      if (!valid) {
        issues.push({
          type: "invalid_launch_target",
          gameId: game.id,
          gameName: game.mName,
          versionId: version.versionId,
          versionName,
          platform: launch.platform,
          launchId: launch.launchId,
          launchName: launch.name,
          command: launch.command,
          detail: reason,
        });
      }
    }

    // 4. A playable (non-setup) version should have a Windows launch — most
    //    games run on Windows (incl. Proton on Linux).
    if (!version.onlySetup) {
      const hasWindows = version.launches.some(
        (l) => l.platform === Platform.Windows,
      );
      if (!hasWindows) {
        issues.push({
          type: "missing_windows_launch",
          gameId: game.id,
          gameName: game.mName,
          versionId: version.versionId,
          versionName,
          detail: "No Windows launch configuration",
        });
      }
    }
  }

  // ── Pass 2: orphaned folders on disk (game granularity) ────────────
  // Top-level game folders present on disk but referenced by no Game row.
  // Report-only — game folders are multi-GB, so the deployer makes the call.
  const libraries = await prisma.library.findMany({
    select: { id: true, name: true },
  });
  for (const lib of libraries) {
    const provider = libraryManager.getLibrary(lib.id);
    if (!provider) continue;

    let onDisk: string[];
    try {
      onDisk = await provider.listGames();
    } catch {
      // Library offline / unreadable — Pass 1 already flags affected
      // versions; skip the orphan sweep for this library.
      continue;
    }

    const inDb = await prisma.game.findMany({
      where: { libraryId: lib.id },
      select: { libraryPath: true, discFolders: true },
    });
    const known = new Set<string>();
    for (const g of inDb) {
      known.add(g.libraryPath);
      for (const disc of g.discFolders ?? []) known.add(disc);
    }

    for (const folder of onDisk) {
      if (!known.has(folder)) {
        issues.push({
          type: "orphaned_folder",
          libraryName: lib.name,
          path: folder,
          detail: `Folder on disk under "${lib.name}" with no game in the database`,
        });
      }
    }
  }

  const count = (t: LibraryAuditIssueType) =>
    issues.filter((i) => i.type === t).length;

  return {
    issues,
    summary: {
      versionsScanned: versions.length,
      orphanedVersions: count("orphaned_version"),
      unreadableVersions: count("unreadable_version"),
      missingTargets: count("missing_launch_target"),
      invalidTargets: count("invalid_launch_target"),
      missingWindowsLaunch: count("missing_windows_launch"),
      mistaggedLinuxLaunches: count("mistagged_linux_launch"),
      orphanedFolders: count("orphaned_folder"),
    },
  };
}
