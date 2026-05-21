/**
 * Shared types for the decomposed version-import pipeline.
 *
 * The top-level `libraryManager.importVersion` orchestrator builds an
 * `ImportContext`, then threads it through the phase functions in
 * `server/internal/library/import/<phase>.ts`. Each phase is a pure-ish
 * function: it takes the context, does one job, and returns a typed
 * result. The orchestrator wires the results together and calls
 * `ctx.markPhase()` between phases so the task log is phase-labelled.
 */

import type { LibraryProvider } from "../provider";
import type { TaskRunContext } from "../../tasks";
import type { DropletManifest } from "../manifest/utils";
import type { GameType, Platform } from "~/prisma/client/enums";
import type { UnimportedVersionInformation } from "../index";
import type { ImportVersion } from "~/server/api/v1/admin/import/version/index.post";

/** Per-import logger shape — phases log via this so output is uniform. */
export type ImportLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

/**
 * Everything the phase functions need, assembled once by the
 * orchestrator. Immutable from a phase's point of view except for
 * `warnings`, which phases append to.
 */
export interface ImportContext {
  gameId: string;
  /** The game's metadata name, for log lines + notifications. */
  gameName: string;
  gameType: GameType;
  libraryId: string;
  /** Raw libraryPath off the Game row (abstract base name for multi-disc). */
  libraryPath: string;
  /** discFolders[] off the Game row (empty for single-disc). */
  discFolders: string[];
  isMultiDisc: boolean;
  /** Steam AppID from metadata, when the game was imported from Steam. */
  steamAppId?: string;

  /** The library provider that owns this game. */
  library: LibraryProvider<unknown>;
  /** The version being imported (local folder or depot identifier). */
  version: UnimportedVersionInformation;
  /** Validated import options from the request body. */
  metadata: typeof ImportVersion.infer;

  /**
   * Effective `autoSwapSteamApiDll` policy (game override → library
   * default → true). Gates only the DLL swap.
   */
  autoSwapDll: boolean;
  /**
   * Effective `autoEmulatorSetup` policy (library default → true).
   * When false the whole setupEmulators phase is a no-op.
   */
  autoEmulatorSetup: boolean;

  /** True for `?dryRun=true` imports — phases must touch nothing. */
  dryRun: boolean;

  /** Task context for progress / logging / phase marks. */
  task: TaskRunContext;
  logger: ImportLogger;

  /** Mutable bag of non-fatal warnings, surfaced in the ImportReceipt. */
  warnings: string[];
}

/** Result of `prepareVersionDirectory`. */
export interface PreparedDirectory {
  /**
   * Absolute on-disk path of the directory the manifest should be
   * generated from. For multi-disc games this is the staging dir with
   * disc symlinks; for single-disc it's the resolved version dir.
   * `undefined` for depot imports (no local filesystem).
   */
  versionDir?: string;
  /**
   * The `versionPath` value to persist on the GameVersion row.
   * `null` for depot imports.
   */
  versionPath: string | null;
  /**
   * For multi-disc games: the new `libraryPath` value (the staging dir
   * name) that must be written to the Game row so torrential can
   * resolve files. `undefined` when no libraryPath change is needed.
   */
  newLibraryPath?: string;
  /** Number of dead junctions pruned (multi-disc hygiene). */
  prunedJunctions: number;
}

/** Result of `setupEmulators`. */
export interface EmulatorSetupResult {
  /** True iff a steam_api DLL was actually swapped on disk. */
  dllSwapApplied: boolean;
  /** Which DLL was swapped, if any. */
  dllSwapName?: string;
  /** True iff the whole phase was skipped (autoEmulatorSetup=false / depot / dry-run). */
  skipped: boolean;
}

/** Result of `generateManifest`. */
export interface ManifestResult {
  manifest: DropletManifest;
  fileList: string[];
}

/** Result of `validateManifest`. */
export interface ManifestValidationResult {
  /** Total files referenced by the manifest. */
  fileCount: number;
  /** Sum of manifest file lengths in bytes. */
  totalSizeBytes: number;
  /** Number of distinct chunks in the manifest. */
  chunkCount: number;
}

/** Result of `persistVersion`. */
export interface PersistResult {
  versionId: string;
}

/**
 * Receipt-shaped object. Returned by a dry-run (without DB writes) and
 * also the payload written to the `ImportReceipt` table on a real run.
 */
export interface ImportReceiptShape {
  gameId: string;
  gameVersionId: string | null;
  phaseTimings: Array<{
    name: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
  }>;
  fileCount: number;
  totalSizeBytes: number;
  chunkCount: number;
  dllSwapApplied: boolean;
  dllSwapName?: string;
  warnings: string[];
  dryRun: boolean;
}

/**
 * Thrown by `validateManifest` when the on-disk files don't match the
 * manifest. The orchestrator lets this propagate so the GameVersion row
 * is never written for a broken import.
 */
export class ManifestValidationError extends Error {
  readonly missing: string[];
  readonly mismatched: string[];

  constructor(missing: string[], mismatched: string[]) {
    const parts: string[] = [];
    if (missing.length > 0)
      parts.push(`${missing.length} file(s) missing on disk`);
    if (mismatched.length > 0)
      parts.push(`${mismatched.length} file(s) with wrong size`);
    super(
      `Manifest validation failed: ${parts.join(", ")}. ` +
        `Import rejected — no GameVersion written.`,
    );
    this.name = "ManifestValidationError";
    this.missing = missing;
    this.mismatched = mismatched;
  }
}

/** A launch entry as resolved from preload info. */
export interface ResolvedLaunch {
  platform: Platform;
  launch: string;
  name: string;
  emulatorId?: string;
}

/** A setup entry as resolved from preload info. */
export interface ResolvedSetup {
  platform: Platform;
  launch: string;
}
