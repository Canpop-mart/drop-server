import type { Platform } from "~/prisma/client/enums";

/**
 * "Refresh versions" (admin/game/[id]/versions/refresh.post.ts) deletes every
 * version of a game and imports them again from disk. Anything set by hand on
 * a version would be lost with it. These helpers carry the hand-set parts
 * across, matched by the version's folder (`versionPath`, which a local import
 * sets to the discovered version's identifier).
 *
 * Pure functions, no database access. drop-server has no test runner, so they
 * are untested beyond the type checker.
 */

/** One existing version as read before the purge. */
export type VersionBeforeRefresh = {
  versionPath: string | null;
  modInstallDir: string;
  launchOverride: string | null;
  launches: Array<{
    platform: Platform;
    name: string;
    command: string;
    emulatorId: string | null;
    discPaths: string[];
  }>;
  /** Versions this one needs (mod prerequisites, for example). */
  requiredContent: Array<{ versionId: string; gameId: string }>;
  /** Versions that need this one, e.g. another mod listing this as required. */
  requiringContent: Array<{ versionId: string; gameId: string }>;
};

/** What survives a refresh for one version folder. */
export type PreservedVersionSettings = {
  modInstallDir: string;
  launchOverride: string | null;
  launches: Array<{
    platform: Platform;
    name: string;
    launch: string;
    emulatorId?: string;
    discPaths: string[];
  }>;
  /** Other games' version ids this version requires. */
  requiredContent: string[];
  /** Other games' version ids that require this version. */
  requiringContent: string[];
};

/**
 * Index the hand-set parts of a game's versions by version folder. Links to
 * other versions of the SAME game are dropped: those rows are about to be
 * deleted, so their ids will not exist after the refresh. A version with no
 * folder (a depot import) cannot be matched to its re-import and is skipped.
 */
export function preserveVersionSettings(
  gameId: string,
  versions: VersionBeforeRefresh[],
): Map<string, PreservedVersionSettings> {
  const out = new Map<string, PreservedVersionSettings>();
  for (const v of versions) {
    if (!v.versionPath) continue;
    out.set(v.versionPath, {
      modInstallDir: v.modInstallDir,
      launchOverride: v.launchOverride,
      launches: v.launches.map((l) => ({
        platform: l.platform,
        name: l.name,
        launch: l.command,
        ...(l.emulatorId ? { emulatorId: l.emulatorId } : {}),
        discPaths: l.discPaths,
      })),
      requiredContent: v.requiredContent
        .filter((rc) => rc.gameId !== gameId)
        .map((rc) => rc.versionId),
      requiringContent: v.requiringContent
        .filter((rc) => rc.gameId !== gameId)
        .map((rc) => rc.versionId),
    });
  }
  return out;
}

/**
 * The settings to re-import a discovered version with, or undefined when it is
 * new (or a depot version, which has no folder to match on).
 */
export function settingsForDiscoveredVersion(
  preserved: Map<string, PreservedVersionSettings>,
  version: { type: string; identifier: string },
): PreservedVersionSettings | undefined {
  if (version.type !== "local") return undefined;
  return preserved.get(version.identifier);
}
