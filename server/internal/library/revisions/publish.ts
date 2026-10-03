/**
 * "Check for changes" and "Publish update" for a version whose folder an
 * admin edited on the server. Both run as tasks under the version lock; a
 * repeat request while one is running attaches to it instead of starting a
 * second read of the folder.
 *
 * Check hashes the folder as it is now (re-reading only files touched since
 * they were last hashed) and compares it with the current revision. It
 * records what it saw in the revision's stat cache, so a publish right after
 * re-reads only files touched since the check.
 *
 * Publish runs the import pipeline's own file phases on the existing folder
 * (emulator setup with the GBE DLL swap, droplet manifest generation, on-disk
 * validation), so the result is what a fresh import of that folder would
 * produce, then stores it under the SAME versionId as the next revision.
 *
 * Results are kept in memory for the admin UI to fetch when the task ends
 * (lost on restart; check again).
 */

import taskHandler, { type TaskRunContext } from "../../tasks";
import { setupEmulators } from "../import/setupEmulators";
import { generateManifest } from "../import/generateManifest";
import { validateManifest } from "../import/validateManifest";
import type { FilePhaseContext, PreparedDirectory } from "../import/types";
import { withVersionLock } from "../versionLock";
import { ensureBaseline } from "./baseline";
import {
  diffRevisionFiles,
  fileSizesFromManifest,
  hasChanges,
  isEmulatorSetupPath,
  type RevisionChanges,
} from "./diff";
import {
  diffFolderAgainstSnapshot,
  sameStamp,
  snapshotWithStatCache,
  statFolderFiles,
} from "./hash";
import prisma from "../../db/database";
import {
  commitNewRevision,
  countUnknown,
  invalidateVersionCaches,
  readSnapshot,
  saveStatCache,
} from "./store";
import { RevisionTargetError, resolveRevisionTarget } from "./target";

/** POST .../changes and POST .../publish answer with this. */
export type VersionTaskStarted = {
  /** "checking": a check task; "publishing": a publish of this version. */
  status: "checking" | "publishing";
  versionId: string;
  currentRevision: number;
  taskId: string;
};

/** GET .../changes: the result of the last finished check. */
export type VersionCheckResult = {
  status: "ready";
  gameId: string;
  versionId: string;
  taskId: string;
  checkedAt: string;
  /** The revision the folder was compared with. */
  currentRevision: number;
  /** Files in that revision whose original hash is unknown (""). */
  unknownInCurrent: number;
  /**
   * Publish runs emulator setup on this version; entries flagged
   * `emulatorSetup` may come out differently after publish.
   */
  emulatorSetup: boolean;
} & RevisionChanges;

/** GET .../publish: the outcome of the last finished publish. */
export type VersionPublishOutcome = {
  gameId: string;
  versionId: string;
  taskId: string;
  finishedAt: string;
  fromRevision: number;
  /** The revision now current: fromRevision + 1, or fromRevision if nothing differed. */
  revision: number;
  published: boolean;
  /** What actually changed from fromRevision, after emulator setup. */
  totals: RevisionChanges["totals"];
};

const checkResults = new Map<string, VersionCheckResult>();
const publishOutcomes = new Map<string, VersionPublishOutcome>();

const publishKey = (versionId: string) => `version-publish-${versionId}`;
const checkKey = (versionId: string) => `version-check-${versionId}`;
const fingerprintKey = (versionId: string) =>
  `version-fingerprint-${versionId}`;

function runningTaskId(key: string): string | undefined {
  return taskHandler.runningTasks().find((t) => t.key === key)?.id;
}

function toHttpError(e: unknown): never {
  if (e instanceof RevisionTargetError) {
    throw createError({ statusCode: e.statusCode, statusMessage: e.message });
  }
  throw e;
}

function wrapLogger(logger: TaskRunContext["logger"]) {
  return {
    info: (msg: string) => logger.info(msg),
    warn: (msg: string) => logger.warn(msg),
  };
}

/**
 * Starts "Check for changes" for a version, or returns the check or publish
 * already running for it. Changes nothing in the folder.
 */
export async function startCheck(
  gameId: string,
  versionId: string,
): Promise<VersionTaskStarted> {
  const target = await resolveRevisionTarget(versionId, gameId, true).catch(
    toHttpError,
  );
  const base = { versionId, currentRevision: target.revision };

  const publishing = runningTaskId(publishKey(versionId));
  if (publishing) return { ...base, status: "publishing", taskId: publishing };
  const checking = runningTaskId(checkKey(versionId));
  if (checking) return { ...base, status: "checking", taskId: checking };

  const taskId = await taskHandler.create({
    key: checkKey(versionId),
    taskGroup: "import:version",
    name: `Checking for changes in ${target.gameName} (${target.versionName})`,
    acls: ["system:import:version:read"],
    async run(task) {
      task.logger.info(
        "Waiting for any other work on this version to finish first",
      );
      await withVersionLock(versionId, () => runCheck(task, gameId, versionId));
    },
  });
  return { ...base, status: "checking", taskId };
}

async function runCheck(
  task: TaskRunContext,
  gameId: string,
  versionId: string,
) {
  const { progress, markPhase, signal } = task;
  const log = wrapLogger(task.logger);
  const target = await resolveRevisionTarget(versionId, gameId, true);

  markPhase("baseline");
  let baselineShare = 0;
  const baseline = await ensureBaseline(target, {
    signal,
    logger: log,
    onProgress: (f) => {
      baselineShare = 50;
      progress(Math.round(f * 50));
    },
  });

  markPhase("compare");
  const diskFiles = await target.library
    .versionReaddir(target.libraryPath, target.versionPath)
    .catch((e) => {
      throw new Error(`Could not list the version folder: ${e}`);
    });
  const result = await diffFolderAgainstSnapshot(
    target.versionDir,
    diskFiles,
    baseline.snapshot.files,
    baseline.snapshot.cache,
    {
      signal,
      logger: log,
      onProgress: (f) =>
        progress(baselineShare + Math.round(f * (100 - baselineShare))),
    },
  );
  await saveStatCache(versionId, baseline.snapshot.revision, result.cache);

  const flag = target.autoEmulatorSetup;
  const mark = (list: RevisionChanges["added"]) =>
    list.map((f) =>
      flag && isEmulatorSetupPath(f.path) ? { ...f, emulatorSetup: true } : f,
    );
  const { totals } = result.changes;
  checkResults.set(versionId, {
    status: "ready",
    gameId: target.gameId,
    versionId,
    taskId: runningTaskId(checkKey(versionId)) ?? "",
    checkedAt: new Date().toISOString(),
    currentRevision: baseline.snapshot.revision,
    unknownInCurrent: countUnknown(baseline.snapshot.files),
    emulatorSetup: flag,
    added: mark(result.changes.added),
    changed: mark(result.changes.changed),
    removed: mark(result.changes.removed),
    totals,
  });
  log.info(
    `Compared with revision ${baseline.snapshot.revision}: ${totals.addedCount} added, ` +
      `${totals.changedCount} changed, ${totals.removedCount} removed ` +
      `(${result.hashed} file(s) read, ${result.reused} unchanged since last hashed)`,
  );
  progress(100);
}

/** POST .../fingerprint answers with this. */
export type FingerprintStarted =
  | { status: "ready"; versionId: string; currentRevision: number }
  | {
      /**
       * "fingerprinting": recording this version's hashes; "checking" /
       * "publishing": a check or publish is running, which records them too.
       */
      status: "fingerprinting" | "checking" | "publishing";
      versionId: string;
      currentRevision: number;
      taskId: string;
    };

/**
 * "Record fingerprints": records the file hashes of a version's current
 * revision, reading every file once, if it has none yet. Nothing records them
 * on its own for versions imported before revisions existed, so an admin does
 * this on the versions they intend to edit and update in place, BEFORE
 * editing the folder (afterwards the original hashes can't be recovered).
 *
 * Returns "ready" straight away when the revision already has fingerprints.
 * A check or publish already running for the version is returned instead,
 * since both record them first.
 */
export async function startFingerprint(
  gameId: string,
  versionId: string,
): Promise<FingerprintStarted> {
  const target = await resolveRevisionTarget(versionId, gameId, true).catch(
    toHttpError,
  );
  const base = { versionId, currentRevision: target.revision };

  const publishing = runningTaskId(publishKey(versionId));
  if (publishing) return { ...base, status: "publishing", taskId: publishing };
  const checking = runningTaskId(checkKey(versionId));
  if (checking) return { ...base, status: "checking", taskId: checking };
  const running = runningTaskId(fingerprintKey(versionId));
  if (running) return { ...base, status: "fingerprinting", taskId: running };

  if (await readSnapshot(versionId, target.revision)) {
    return { ...base, status: "ready" };
  }

  const taskId = await taskHandler.create({
    key: fingerprintKey(versionId),
    taskGroup: "import:version",
    name: `Recording fingerprints for ${target.gameName} (${target.versionName})`,
    acls: ["system:import:version:read"],
    async run(task) {
      task.logger.info(
        "Waiting for any other work on this version to finish first",
      );
      await withVersionLock(versionId, async () => {
        const fresh = await resolveRevisionTarget(versionId, gameId, true);
        task.markPhase("baseline");
        const result = await ensureBaseline(fresh, {
          signal: task.signal,
          logger: wrapLogger(task.logger),
          onProgress: (f) => task.progress(Math.round(f * 100)),
        });
        task.logger.info(
          result.created
            ? `Recorded fingerprints for ${result.snapshot.files.length} file(s), revision ${result.snapshot.revision}`
            : `Fingerprints for revision ${result.snapshot.revision} were already recorded`,
        );
        task.progress(100);
      });
    },
  });
  return { ...base, status: "fingerprinting", taskId };
}

/**
 * Which versions of a game have fingerprints for their current revision,
 * with how many of those files have an unknown original hash.
 */
export async function listFingerprints(
  gameId: string,
): Promise<Record<string, { revision: number; unknown: number }>> {
  const versions = await prisma.gameVersion.findMany({
    where: { gameId },
    select: { versionId: true, revision: true },
  });
  const out: Record<string, { revision: number; unknown: number }> = {};
  for (const v of versions) {
    const snap = await readSnapshot(v.versionId, v.revision);
    if (snap)
      out[v.versionId] = {
        revision: v.revision,
        unknown: countUnknown(snap.files),
      };
  }
  return out;
}

/** The last finished check of a version, or null (none since boot). */
export function getCheckResult(
  gameId: string,
  versionId: string,
): VersionCheckResult | null {
  const r = checkResults.get(versionId);
  return r && r.gameId === gameId ? r : null;
}

/** The last finished publish of a version, or null (none since boot). */
export function getPublishOutcome(
  gameId: string,
  versionId: string,
): VersionPublishOutcome | null {
  const r = publishOutcomes.get(versionId);
  return r && r.gameId === gameId ? r : null;
}

/**
 * Starts the publish task for a version and returns its task id. If a
 * publish of the same version is already running, returns that one.
 */
export async function startPublish(
  gameId: string,
  versionId: string,
): Promise<VersionTaskStarted> {
  const target = await resolveRevisionTarget(versionId, gameId, true).catch(
    toHttpError,
  );
  const base = { versionId, currentRevision: target.revision };
  const running = runningTaskId(publishKey(versionId));
  if (running) return { ...base, status: "publishing", taskId: running };

  const id = await taskHandler.create({
    key: publishKey(versionId),
    taskGroup: "import:version",
    name: `Publishing update for ${target.gameName} (${target.versionName})`,
    acls: ["system:import:version:read"],
    async run(task) {
      task.logger.info(
        "Waiting for any other work on this version to finish first",
      );
      await withVersionLock(versionId, () =>
        runPublish(task, gameId, versionId),
      );
    },
  });
  return { ...base, status: "publishing", taskId: id };
}

async function runPublish(
  task: TaskRunContext,
  gameId: string,
  versionId: string,
) {
  const { progress, markPhase, signal } = task;
  const log = wrapLogger(task.logger);
  const taskIdNow = runningTaskId(publishKey(versionId)) ?? "";

  // Re-resolve inside the lock: the version may have changed while queued.
  const target = await resolveRevisionTarget(versionId, gameId, true);
  const fromRevision = target.revision;
  // Whatever the last check showed is about to be out of date.
  checkResults.delete(versionId);

  // ── 1. Baseline: the files as clients have them now ─────────────────
  markPhase("baseline");
  const baseline = await ensureBaseline(target, {
    signal,
    logger: log,
    onProgress: (f) => progress(Math.round(f * 30)),
  });
  progress(30);

  // The import pipeline's phases, run on this version's existing folder.
  const ctx: FilePhaseContext = {
    gameId: target.gameId,
    version: {
      type: "local",
      name: target.versionName,
      identifier: target.versionPath,
    },
    library: target.library,
    libraryPath: target.libraryPath,
    discFolders: [],
    isMultiDisc: false,
    autoEmulatorSetup: target.autoEmulatorSetup,
    dryRun: false,
    task: {
      ...task,
      // generateManifest reports 0 to 90; map it onto 35 to 75 here.
      progress: (p: number) => progress(35 + Math.round((p / 90) * 40)),
    },
    logger: log,
    warnings: [],
  };
  const prepared: PreparedDirectory = {
    versionDir: target.versionDir,
    versionPath: target.versionPath,
    prunedJunctions: 0,
  };

  // ── 2. Emulator setup (GBE DLL swap), before the manifest, as on import ─
  markPhase("emulator");
  await setupEmulators(ctx, target.versionDir);
  progress(35);

  // Stat every file before droplet reads them, so a change made while this
  // runs is caught instead of published half-way.
  const before = await target.library.versionReaddir(
    target.libraryPath,
    target.versionPath,
  );
  const beforeStats = await statFolderFiles(target.versionDir, before, signal);

  // ── 3. Manifest ──────────────────────────────────────────────────────
  markPhase("manifest");
  const manifestResult = await generateManifest(ctx, prepared);
  progress(75);

  // ── 4. Validate on-disk sizes against the manifest ───────────────────
  markPhase("validate");
  await validateManifest(ctx, prepared, manifestResult);

  const sizes = fileSizesFromManifest(manifestResult.manifest.chunks);
  const sameSet = (list: Iterable<string>) => {
    const s = new Set(list);
    return s.size === sizes.size && [...sizes.keys()].every((f) => s.has(f));
  };
  if (!sameSet(before) || !sameSet(manifestResult.fileList)) {
    throw new Error(
      "Files were added or removed in the version folder while publishing. Nothing was published; try again once nothing is writing to the folder.",
    );
  }

  // ── 5. Hash (only files touched since they were last hashed) ─────────
  markPhase("hash");
  const next = await snapshotWithStatCache(
    target.versionDir,
    [...sizes].map(([path, size]) => ({ path, size })),
    baseline.snapshot.cache,
    {
      signal,
      logger: log,
      onProgress: (f) => progress(75 + Math.round(f * 20)),
    },
  );
  for (const [path, entry] of next.cache) {
    const was = beforeStats.get(path);
    if (!was || !sameStamp(was, entry.stamp)) {
      throw new Error(
        `${path} changed while publishing. Nothing was published; try again once nothing is writing to the folder.`,
      );
    }
  }
  log.info(
    `Read ${next.hashed} file(s), ${next.reused} unchanged since last hashed`,
  );

  const changes = diffRevisionFiles(baseline.snapshot.files, next.files);
  const { totals } = changes;
  const outcome = (revision: number, published: boolean) =>
    publishOutcomes.set(versionId, {
      gameId: target.gameId,
      versionId,
      taskId: taskIdNow,
      finishedAt: new Date().toISOString(),
      fromRevision,
      revision,
      published,
      totals,
    });

  if (!hasChanges(changes)) {
    // Keep what was seen, so the next check doesn't read these files again.
    await saveStatCache(versionId, fromRevision, next.cache);
    outcome(fromRevision, false);
    log.info(
      `No file differs from revision ${fromRevision}. Nothing was published.`,
    );
    progress(100);
    return;
  }

  // ── 6. Store the new revision (manifest, file list, snapshot) ───────
  markPhase("persist");
  const revision = await commitNewRevision({
    gameId: target.gameId,
    versionId,
    fromRevision,
    manifestJson: JSON.stringify(manifestResult.manifest),
    fileList: manifestResult.fileList,
    files: next.files,
    cache: next.cache,
  });
  outcome(revision, true);
  log.info(
    `Published revision ${revision}: ${totals.addedCount} added, ` +
      `${totals.changedCount} changed, ${totals.removedCount} removed`,
  );

  // ── 7. Clear every cache holding the old manifest or sizes ──────────
  markPhase("caches");
  await invalidateVersionCaches(target.gameId, versionId, log);
  progress(100);
}
