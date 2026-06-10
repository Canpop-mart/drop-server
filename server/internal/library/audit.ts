/**
 * Launch-config & version integrity audit.
 *
 * Walks every GameVersion and verifies, against what's actually on disk:
 *   - the version's folder still exists (orphaned DB rows);
 *   - each launch target exists and is plausibly executable for its platform
 *     (Windows → .exe/.bat; Linux → ELF binary / .sh / .AppImage / .x86_64,
 *     NOT a data file like .bin/.pak/.uasset; macOS → .app). Emulator launches
 *     point at a ROM/disc, so only their existence is checked;
 *   - non-setup versions have a Windows launch (the common "Windows via Proton"
 *     case).
 *
 * Report-only — it never mutates. Shared by the scan task and the admin API.
 */
import fs from "fs";
import path from "path";
import prisma from "../db/database";
import { libraryManager } from ".";
import { Platform } from "~/prisma/client/enums";

export type LaunchAuditIssueType =
  | "orphaned_version"
  | "missing_launch_target"
  | "invalid_launch_target"
  | "missing_windows_launch";

export interface LaunchAuditIssue {
  type: LaunchAuditIssueType;
  gameId: string;
  gameName: string;
  versionId: string;
  versionName: string;
  platform?: Platform;
  launchId?: string;
  launchName?: string;
  command?: string;
  detail: string;
}

export interface LaunchAuditResult {
  issues: LaunchAuditIssue[];
  summary: {
    versionsScanned: number;
    orphanedVersions: number;
    missingTargets: number;
    invalidTargets: number;
    missingWindowsLaunch: number;
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

/** Strip surrounding quotes a shell-escaped command path may carry. */
function unquote(cmd: string): string {
  const t = cmd.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Resolve a launch command to an on-disk path relative to `versionDir`.
 * Falls back to the first whitespace token when the full command (which may
 * carry trailing args) doesn't resolve.
 */
function resolveLaunchTarget(
  versionDir: string,
  command: string,
): { rel: string; fullPath: string; exists: boolean } {
  const rel = unquote(command);
  const fullPath = path.join(versionDir, rel);
  if (fs.existsSync(fullPath)) return { rel, fullPath, exists: true };

  const firstToken = unquote(command.split(/\s+/)[0] ?? "");
  if (firstToken && firstToken !== rel) {
    const alt = path.join(versionDir, firstToken);
    if (fs.existsSync(alt))
      return { rel: firstToken, fullPath: alt, exists: true };
  }
  return { rel, fullPath, exists: false };
}

export async function auditLaunchConfigs(): Promise<LaunchAuditResult> {
  const issues: LaunchAuditIssue[] = [];

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
      // Can't validate targets without a folder.
      continue;
    }

    // 2. Validate each launch target.
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

      // Emulator launches point at a ROM/disc, not an executable — the
      // existence check above is all that applies.
      if (launch.emulatorId) continue;

      const ext = path.extname(fullPath).toLowerCase();
      let valid: boolean;
      let reason: string;

      if (launch.platform === Platform.Windows) {
        valid = ext === ".exe" || ext === ".bat" || ext === ".cmd";
        reason = `Windows launch should be an .exe/.bat — got "${rel}"`;
      } else if (launch.platform === Platform.Linux) {
        if (LINUX_EXEC_EXTS.has(ext)) {
          valid = true;
        } else if (DATA_FILE_EXTS.has(ext)) {
          valid = false;
        } else {
          // Unknown / no extension — accept only a real ELF binary or script.
          valid = isElf(fullPath) || isShebang(fullPath);
        }
        reason = `Linux launch should be an ELF binary / .sh / .AppImage / .x86_64 — got "${rel}"`;
      } else {
        // macOS — expect a .app bundle.
        valid = ext === ".app";
        reason = `macOS launch should be a .app — got "${rel}"`;
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

    // 3. A playable (non-setup) version should have a Windows launch — most
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

  const count = (t: LaunchAuditIssueType) =>
    issues.filter((i) => i.type === t).length;

  return {
    issues,
    summary: {
      versionsScanned: versions.length,
      orphanedVersions: count("orphaned_version"),
      missingTargets: count("missing_launch_target"),
      invalidTargets: count("invalid_launch_target"),
      missingWindowsLaunch: count("missing_windows_launch"),
    },
  };
}
