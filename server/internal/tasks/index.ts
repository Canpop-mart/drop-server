import type { MinimumRequestObject } from "~/server/h3";
import type { GlobalACL } from "../acls";
import aclManager from "../acls";
import { taskGroups, type TaskGroup } from "./group";
import prisma from "../db/database";
import { ArkErrors, type } from "arktype";
import pino from "pino";
import { logger } from "~/server/internal/logging";
import { Writable } from "node:stream";

import cleanupAuthRecords from "./registry/auth-records";
import checkUpdate from "./registry/update";
import cleanupObjects from "./registry/objects";
import cleanupCompatLogs from "./registry/cleanup-compat-logs";
import checkGameUpdates from "./registry/game-update";
import scanGoldbergReadiness from "./registry/goldberg-readiness";
import refreshAchievementDefs from "./registry/refresh-achievement-defs";
import linkRetroAchievements from "./registry/link-retroachievements";
import regenerateManifests from "./registry/regenerate-manifests";
import recalculatePlaytime from "./registry/recalculate-playtime";
import recalculateAchievements from "./registry/recalculate-achievements";
import scanLibraryIntegrity from "./registry/library-integrity";
import refreshMetadata from "./registry/refresh-metadata";
import backupExport from "./registry/backup-export";

type TaskActionLink = `${string}:${string}`;

// ── Receipt helpers ────────────────────────────────────────────────
export type TaskReceiptStatus = "success" | "failed" | "cancelled" | "orphaned";

export type TaskPhase = {
  name: string;
  startedAt: string;
  endedAt: string;
};

// a task that has been run
type FinishedTask = {
  success: boolean;
  progress: number;
  key: string | undefined;
  log: string[];
  error: { title: string; description: string } | undefined;
  name: string;
  taskGroup: TaskGroup;
  acls: string[];
  actions: TaskActionLink[];

  // ISO timestamp of when the task started
  startTime: string;
  // ISO timestamp of when the task ended
  endTime: string | undefined;

  // cancellation
  cancelled: boolean;
  abortController: AbortController;
  phases: TaskPhase[];
  /// Snapshot of the original task definition so we can rebuild it for retry.
  retryArgs:
    | {
        taskGroup: TaskGroup;
        name: string;
        key: string | undefined;
        acls: string[];
        initialActions: TaskActionLink[];
        kind: "registered" | "ad-hoc";
      }
    | undefined;
};

// a currently running task in the pool
type TaskPoolEntry = FinishedTask & {
  clients: Map<string, boolean>;
};

/**
 * The TaskHandler setups up two-way connections to web clients and manages the state for them
 * This allows long-running tasks (like game imports and such) to report progress, success and error states
 * easily without re-inventing the wheel every time.
 *
 * As of the 2026 audit (see docs/audit/tasks-2026.md), every registered task is
 * declared via `defineDropTask`, may optionally declare a `schedule`, and gets
 * a TaskReceipt row when it finishes. Cancel and retry are first-class.
 * `taskHandler.create()` is kept as a back-compat shim for ad-hoc imports
 * (library/metadata flow) — those still work but don't get the dedup/schedule
 * machinery a `DropTask` does.
 */
class TaskHandler {
  // registry of scheduled tasks to be created
  private taskCreators: Map<TaskGroup, DropTask> = new Map();

  // list of all currently running tasks
  private taskPool = new Map<string, TaskPoolEntry>();
  // list of all clients currently connected to tasks
  private clientRegistry = new Map<string, PeerImpl>();

  private dailyScheduledTasks: TaskGroup[] = [
    "cleanup:auth-records",
    "cleanup:compat-logs",
    "check:update",
  ];
  private weeklyScheduledTasks: TaskGroup[] = [
    "cleanup:objects",
    "scan:library-integrity",
  ];

  constructor() {
    // Scheduled cleanup / health
    this.saveScheduledTask(cleanupAuthRecords);
    this.saveScheduledTask(checkUpdate);
    this.saveScheduledTask(cleanupObjects);
    this.saveScheduledTask(cleanupCompatLogs);

    // Library maintenance (on-demand + weekly integrity audit)
    this.saveScheduledTask(checkGameUpdates);
    this.saveScheduledTask(scanLibraryIntegrity);
    this.saveScheduledTask(refreshMetadata);

    // Achievements (on-demand)
    this.saveScheduledTask(scanGoldbergReadiness);
    this.saveScheduledTask(refreshAchievementDefs);
    this.saveScheduledTask(linkRetroAchievements);
    this.saveScheduledTask(recalculateAchievements);
    this.saveScheduledTask(regenerateManifests);

    // System (on-demand)
    this.saveScheduledTask(recalculatePlaytime);
    this.saveScheduledTask(backupExport);
  }

  /**
   * Saves scheduled task to the registry
   */
  private saveScheduledTask(task: DropTask) {
    this.taskCreators.set(task.taskGroup, task);
  }

  /**
   * Walks every registered task and seeds its dedupKey on disk if missing.
   * Not exposed publicly — used only by `scheduler.ts` and admin endpoints
   * that need to enumerate registered tasks.
   */
  getRegisteredTasks(): ReadonlyMap<TaskGroup, DropTask> {
    return this.taskCreators;
  }

  /**
   * Returns the registered DropTask for a group, or undefined for ad-hoc
   * groups (import:game, import:version).
   */
  getRegisteredTask(group: TaskGroup): DropTask | undefined {
    return this.taskCreators.get(group);
  }

  /**
   * Sweeps unfinished TaskReceipt rows on startup. Anything still marked
   * `in_progress` (no endedAt + status="in_progress") came from a server
   * that crashed mid-task — flip it to `orphaned` so the admin UI shows
   * a consistent picture and so retry can target it.
   *
   * Idempotent. Safe to run multiple times.
   */
  async sweepOrphanedReceipts(): Promise<number> {
    const orphans = await prisma.taskReceipt.updateMany({
      where: { status: "in_progress", endedAt: null },
      data: {
        status: "orphaned",
        endedAt: new Date(),
        error: "Server restarted before this task finished",
      },
    });
    if (orphans.count > 0) {
      logger.warn(
        `[TASK:sweep] Marked ${orphans.count} orphaned receipt(s) from a previous crash`,
      );
    }
    return orphans.count;
  }

  async create(iTask: Omit<Task, "id">, parentTask?: TaskRunContext) {
    const task: Task = { ...iTask, id: crypto.randomUUID() };
    if (this.hasTaskID(task.id))
      throw new Error("Task with ID already exists.");
    if (task.key && this.hasTaskKey(task.key))
      throw new Error("Task with key already exists");

    let updateCollectTimeout: NodeJS.Timeout | undefined;
    let updateCollectResolves: Array<(value: unknown) => void> = [];
    let logOffset: number = 0;

    // Single-flight by group (existing behaviour). Concurrent groups
    // (import:*) bypass this. Per-task dedup via task.key is enforced
    // above by hasTaskKey.
    if (!taskGroups[task.taskGroup].concurrency) {
      for (const existingTask of this.taskPool.values()) {
        if (existingTask.taskGroup === task.taskGroup) {
          logger.warn(
            `[TASK:${task.taskGroup}] Task group does not allow concurrent tasks — refusing to start ${task.id}`,
          );
          throw new Error(
            `Task group ${task.taskGroup} does not allow concurrent tasks.`,
          );
        }
      }
    }

    const abortController = new AbortController();

    const updateAllClients = (reset = false) =>
      new Promise((r) => {
        //if (parentTask) return; // NO-OP if we're a child task
        if (updateCollectTimeout) {
          updateCollectResolves.push(r);
          return;
        }
        updateCollectTimeout = setTimeout(() => {
          const taskEntry = this.taskPool.get(task.id);
          if (!taskEntry) return;

          const taskMessage: TaskMessage = {
            id: task.id,
            name: taskEntry.name,
            success: taskEntry.success,
            progress: taskEntry.progress,
            error: taskEntry.error,
            log: taskEntry.log.slice(logOffset),
            reset,
            actions: taskEntry.actions,
          };
          logOffset = taskEntry.log.length;

          for (const clientId of taskEntry.clients.keys()) {
            const client = this.clientRegistry.get(clientId);
            if (!client) continue;
            client.send(JSON.stringify(taskMessage));
          }
          updateCollectTimeout = undefined;

          for (const resolve of updateCollectResolves) {
            resolve(undefined);
          }
          r(undefined);
          updateCollectResolves = [];
        }, 100);
      });

    const taskPool = this.taskPool;

    // Custom writable stream to capture logs
    const logStream = new Writable({
      objectMode: true,
      write(chunk, encoding, callback) {
        try {
          // chunk is a stringified JSON log line
          const logObj = TaskLog(JSON.parse(chunk.toString()));
          if (logObj instanceof ArkErrors) {
            throw logObj;
          }
          const taskEntry = taskPool.get(task.id);
          if (taskEntry) {
            taskEntry.log.push(JSON.stringify(logObj));
            updateAllClients();
          }
        } catch (e) {
          // fallback: ignore or log error
          logger.error(`Failed to parse log chunk: ${e}, ${chunk}`);
        }
        callback();
      },
    });

    // Use pino with the custom stream
    const taskLogger =
      parentTask?.logger ??
      pino(
        {
          // You can configure timestamp, level, etc. here
          timestamp: pino.stdTimeFunctions.isoTime,
          base: null, // Remove pid/hostname if not needed
          formatters: {
            level(label) {
              return {
                level: label,
              };
            },
          },
        },
        logStream,
      );

    const progress =
      parentTask?.progress ??
      ((progress: number) => {
        if (progress < 0 || progress > 100) {
          logger.error("Progress must be between 0 and 100", { progress });
          return;
        }
        const taskEntry = this.taskPool.get(task.id);
        if (!taskEntry) return;
        taskEntry.progress = progress;
        updateAllClients();
      });

    // ── Phase tracking ────────────────────────────────────────────
    // Tasks declare phases via context.markPhase("phase name") so
    // TaskReceipt.progressLog can record timing. Cheap to call (just
    // closes the previous phase and opens a new one).
    let openPhase: { name: string; startedAt: string } | null = null;
    const closeOpenPhase = () => {
      const entry = this.taskPool.get(task.id);
      if (!entry || !openPhase) return;
      entry.phases.push({
        name: openPhase.name,
        startedAt: openPhase.startedAt,
        endedAt: new Date().toISOString(),
      });
      openPhase = null;
    };
    const markPhase = (name: string) => {
      closeOpenPhase();
      openPhase = { name, startedAt: new Date().toISOString() };
      taskLogger.info(`[phase] ${name}`);
    };

    const registered = this.taskCreators.get(task.taskGroup);

    this.taskPool.set(task.id, {
      name: task.name,
      key: task.key,
      taskGroup: task.taskGroup,
      success: false,
      progress: 0,
      error: undefined,
      log: [],
      clients: new Map(),
      acls: task.acls,
      startTime: new Date().toISOString(),
      endTime: undefined,
      actions: task.initialActions ?? [],
      cancelled: false,
      abortController,
      phases: [],
      retryArgs: {
        taskGroup: task.taskGroup,
        name: task.name,
        key: task.key,
        acls: task.acls,
        initialActions: task.initialActions ?? [],
        // We can only auto-retry tasks built from the registry — ad-hoc
        // tasks (game imports etc.) have closures we can't reconstruct.
        kind: registered ? "registered" : "ad-hoc",
      },
    });

    await updateAllClients(true);

    // Write a placeholder receipt up-front so the orphan sweep on
    // startup can find rows from a crashed server. We update this row
    // at the end of taskFunc with the real status / error / phases.
    // Only top-level tasks (no parentTask) get their own receipt —
    // sub-tasks roll up under the parent's row.
    if (!parentTask) {
      try {
        await prisma.taskReceipt.create({
          data: {
            id: task.id,
            taskKey: task.key ?? null,
            taskGroup: task.taskGroup,
            name: task.name,
            acls: task.acls,
            actions: task.initialActions ?? [],
            startedAt: new Date(),
            status: "in_progress",
            progress: 0,
            retryArgs: {
              taskGroup: task.taskGroup,
              name: task.name,
              key: task.key,
              acls: task.acls,
              initialActions: task.initialActions ?? [],
              kind: registered ? "registered" : "ad-hoc",
            },
          },
        });
      } catch (e) {
        logger.error(
          `[TASK:${task.taskGroup}] Failed to write initial TaskReceipt for ${task.id}: ${e}`,
        );
      }
    }

    const taskFunc = async () => {
      const taskEntry = this.taskPool.get(task.id);
      if (!taskEntry) throw new Error("No task entry");
      const addAction = (action: TaskActionLink) => {
        taskEntry.actions.push(action);
        updateAllClients();
      };

      let status: TaskReceiptStatus = "success";

      try {
        await task.run({
          progress,
          logger: taskLogger,
          addAction,
          markPhase,
          signal: abortController.signal,
        });
        if (taskEntry.cancelled) {
          status = "cancelled";
          taskEntry.error = {
            title: "Task cancelled",
            description: "Cancelled from the admin UI",
          };
        } else {
          taskEntry.success = true;
        }
      } catch (error: unknown) {
        taskEntry.success = false;
        if (taskEntry.cancelled) {
          status = "cancelled";
          taskEntry.error = {
            title: "Task cancelled",
            description:
              error instanceof Error
                ? error.message
                : "Cancelled from the admin UI",
          };
        } else {
          status = "failed";
          taskEntry.error = {
            title: "An error occurred",
            description: error instanceof Error ? error.message : String(error),
          };
        }
        logger.warn(
          `[TASK:${taskEntry.taskGroup}] Task ${task.id} ended ${status}: ${taskEntry.error.description}`,
        );
      }

      closeOpenPhase();
      taskEntry.endTime = new Date().toISOString();
      await updateAllClients();

      if (!parentTask) {
        for (const clientId of taskEntry.clients.keys()) {
          if (!this.clientRegistry.get(clientId)) continue;
          this.disconnect(clientId, task.id);
        }

        // Legacy Task row — preserved for back-compat with old admin
        // queries until the UI fully moves to TaskReceipt.
        await prisma.task.create({
          data: {
            id: task.id,
            taskGroup: taskEntry.taskGroup,
            name: taskEntry.name,

            started: taskEntry.startTime,
            ended: taskEntry.endTime,

            success: taskEntry.success,
            progress: taskEntry.progress,
            log: taskEntry.log,

            acls: taskEntry.acls,
            actions: taskEntry.actions,

            ...(taskEntry.error ? { error: taskEntry.error } : undefined),
          },
        });

        // Seal the in-flight TaskReceipt that was written at task
        // start. We update by id (PK) — if the placeholder row is
        // missing for some reason (e.g. the create above failed),
        // upsert recovers gracefully so we still get a receipt.
        try {
          const final = {
            endedAt: new Date(taskEntry.endTime),
            status,
            error: taskEntry.error?.description ?? null,
            progress: taskEntry.progress,
            actions: taskEntry.actions,
            progressLog: {
              phases: taskEntry.phases,
              log: taskEntry.log,
            },
          };
          await prisma.taskReceipt.upsert({
            where: { id: task.id },
            update: final,
            create: {
              id: task.id,
              taskKey: taskEntry.key ?? null,
              taskGroup: taskEntry.taskGroup,
              name: taskEntry.name,
              acls: taskEntry.acls,
              startedAt: new Date(taskEntry.startTime),
              retryArgs: taskEntry.retryArgs
                ? (taskEntry.retryArgs as unknown as object)
                : undefined,
              ...final,
            },
          });
        } catch (e) {
          logger.error(
            `[TASK:${taskEntry.taskGroup}] Failed to seal TaskReceipt for ${task.id}: ${e}`,
          );
        }
      }
      this.taskPool.delete(task.id);
    };

    const fnPromise = taskFunc();
    if (parentTask) await fnPromise;

    return task.id;
  }

  /**
   * Signal a running task to abort. The task's run() must respect the
   * AbortSignal (passed in TaskRunContext) for this to do anything —
   * we can't kill arbitrary async work mid-flight.
   *
   * Returns true if a running task was found, false otherwise.
   */
  cancel(taskId: string): boolean {
    const entry = this.taskPool.get(taskId);
    if (!entry) return false;
    if (entry.cancelled) return true;
    entry.cancelled = true;
    entry.abortController.abort(
      new Error(`Task ${entry.taskGroup} cancelled by admin`),
    );
    logger.info(
      `[TASK:${entry.taskGroup}] Cancellation requested for ${taskId}`,
    );
    return true;
  }

  async connect(
    clientId: string,
    taskId: string,
    peer: PeerImpl,
    request: MinimumRequestObject,
  ) {
    const task =
      this.taskPool.get(taskId) ??
      (await prisma.task.findFirst({
        where: { id: taskId },
        orderBy: { started: "desc" },
      }));
    if (!task) {
      peer.send(
        `error/${taskId}/Unknown task/Drop couldn't find the task you're looking for.`,
      );
      return;
    }

    // cast acls due to prisma types being less strict
    const allowed = await aclManager.hasACL(request, task.acls as GlobalACL[]);
    if (!allowed) {
      // logger.warn("user does not have necessary ACLs");
      peer.send(
        `error/${taskId}/Unknown task/Drop couldn't find the task you're looking for.`,
      );
      return;
    }

    this.clientRegistry.set(clientId, peer);
    if ("clients" in task) {
      task.clients.set(clientId, true); // Uniquely insert client to avoid sending duplicate traffic
    }

    const catchupMessage: TaskMessage = {
      id: taskId,
      name: task.name,
      success: task.success,
      error: task.error as unknown as
        | { title: string; description: string }
        | undefined,
      log: task.log,
      progress: task.progress,
      actions: task.actions as TaskActionLink[],
    };
    peer.send(JSON.stringify(catchupMessage));
  }

  sendDisconnectEvent(id: string, taskId: string) {
    const client = this.clientRegistry.get(id);
    if (!client) return;
    client.send(`disconnect/${taskId}`);
  }

  disconnectAll(id: string) {
    for (const taskId of this.taskPool.keys()) {
      this.taskPool.get(taskId)?.clients.delete(id);
      this.sendDisconnectEvent(id, taskId);
    }

    this.clientRegistry.delete(id);
  }

  disconnect(id: string, taskId: string) {
    const task = this.taskPool.get(taskId);
    if (!task) return false;

    task.clients.delete(id);
    this.sendDisconnectEvent(id, taskId);

    const allClientIds = this.taskPool
      .values()
      .toArray()
      .map((e) => e.clients.keys().toArray())
      .flat();

    if (!allClientIds.includes(id)) {
      this.clientRegistry.delete(id);
    }

    return true;
  }

  runningTasks() {
    return this.taskPool
      .entries()
      .map(([id, value]) => ({ ...value, id, log: undefined }))
      .toArray();
  }

  hasTaskID(id: string) {
    return this.taskPool.has(id);
  }

  hasTaskKey(key: string) {
    return (
      this.taskPool.values().find((v) => v.key && v.key == key) != undefined
    );
  }

  dailyTasks() {
    return this.dailyScheduledTasks;
  }

  weeklyTasks() {
    return this.weeklyScheduledTasks;
  }

  async runTaskGroupByName(name: TaskGroup) {
    const registered = this.taskCreators.get(name);
    if (!registered) {
      logger.warn(`No task found for group ${name}`);
      return;
    }
    const task = registered.build();
    const id = await this.create(task);
    return id;
  }

  /**
   * Runs all daily tasks that are scheduled to run once a day.
   */
  async triggerDailyTasks() {
    for (const taskGroup of this.dailyScheduledTasks) {
      const mostRecent = await prisma.task.findFirst({
        where: {
          taskGroup,
        },
        orderBy: {
          ended: "desc",
        },
      });
      if (mostRecent) {
        const currentTime = Date.now();
        const lastRun = mostRecent.ended.getTime();
        const difference = currentTime - lastRun;
        if (difference < 1000 * 60 * 60 * 24) {
          // If it's been less than one day
          continue; // skip
        }
      }
      await this.runTaskGroupByName(taskGroup);
    }

    // After running daily tasks, trigger weekly tasks as well
    await this.triggerWeeklyTasks();
  }

  private async triggerWeeklyTasks() {
    for (const taskGroup of this.weeklyScheduledTasks) {
      const mostRecent = await prisma.task.findFirst({
        where: {
          taskGroup,
        },
        orderBy: {
          ended: "desc",
        },
      });
      if (mostRecent) {
        const currentTime = Date.now();
        const lastRun = mostRecent.ended.getTime();
        const difference = currentTime - lastRun;
        if (difference < 1000 * 60 * 60 * 24 * 7) {
          // If it's been less than one week
          continue; // skip
        }
      }
      await this.runTaskGroupByName(taskGroup);
    }
  }
}

export type TaskRunContext = {
  progress: (progress: number) => void;
  logger: typeof logger;
  addAction: (link: TaskActionLink) => void;
  /**
   * Open a new named phase. The previous phase (if any) is closed and
   * its duration captured in TaskReceipt.progressLog.phases. Cheap to
   * call — purely an accounting hook, doesn't affect progress %.
   */
  markPhase: (name: string) => void;
  /**
   * Cancellation signal — fires when the admin hits Cancel. Long loops
   * inside a task should periodically check `signal.aborted` and bail.
   * AbortSignal-aware libraries (fetch, fs/promises, etc.) can be
   * passed `{ signal }` directly.
   */
  signal: AbortSignal;
};

export function wrapTaskContext(
  context: TaskRunContext,
  options: { min: number; max: number; prefix: string },
): TaskRunContext {
  const child = context.logger.child({
    prefix: options.prefix,
  });

  return {
    ...context,
    progress(progress) {
      if (progress > 100 || progress < 0) {
        logger.warn("[wrapTaskContext] progress must be between 0 and 100");
      }

      // I was too tired to figure this out
      // https://stackoverflow.com/a/929107
      const oldRange = 100;
      const newRange = options.max - options.min;
      const adjustedProgress = (progress * newRange) / oldRange + options.min;
      return context.progress(adjustedProgress);
    },
    logger: child,
    // markPhase and signal pass straight through — the parent owns
    // both. We don't want sub-tasks to flip phase names underneath
    // the parent.
    markPhase: context.markPhase,
    signal: context.signal,
  };
}

export interface Task {
  id: string;
  key?: string;
  taskGroup: TaskGroup;
  name: string;
  run: (context: TaskRunContext) => Promise<void>;
  acls: GlobalACL[];
  initialActions?: TaskActionLink[];
}

export type TaskMessage = {
  id: string;
  name: string;
  success: boolean;
  progress: number;
  error: null | undefined | { title: string; description: string };
  log: string[];
  reset?: boolean;
  actions: TaskActionLink[];
};

export type PeerImpl = {
  send: (message: string) => void;
  close: () => void;
};

/**
 * Schedule declared by a DropTask. Two flavours, evaluated by
 * `scheduler.ts` at boot:
 *   - `{ intervalMs }` — run every N ms after the last completion.
 *   - `{ daily: true }` / `{ weekly: true }` — bucket into the legacy
 *     daily/weekly scheduler so behaviour stays identical for the
 *     four tasks that already used it.
 */
export type DropTaskSchedule =
  | { intervalMs: number }
  | { daily: true }
  | { weekly: true };

export interface BuildTask {
  buildId: () => string;
  taskGroup: TaskGroup;
  name: string;
  run: (context: TaskRunContext) => Promise<void>;
  acls: GlobalACL[];
  initialActions?: TaskActionLink[];
  schedule?: DropTaskSchedule;
  /**
   * Optional lifecycle hooks. Run inside the same try/catch as `run`
   * so failures here surface as task failures with a sensible error
   * message instead of unhandled promise rejections.
   *
   * Order: setup -> run -> teardown (always). onError fires once on
   * any setup/run failure, before teardown.
   */
  setup?: (context: TaskRunContext) => Promise<void>;
  teardown?: (context: TaskRunContext) => Promise<void>;
  onError?: (error: unknown, context: TaskRunContext) => Promise<void>;
  /**
   * Returns a stable string identifying "the same run". If a task with
   * the same key is already running, `create()` refuses to start
   * another. Defaults to a per-group key, which together with the
   * existing concurrency:false flag enforces single-flight.
   */
  dedupKey?: () => string;
}

export interface DropTask {
  taskGroup: TaskGroup;
  schedule?: DropTaskSchedule;
  build: () => Task;
}

export const TaskLog = type({
  time: "string",
  msg: "string",
  level: "string",
  prefix: "string?",
});

/**
 * Wrap a BuildTask in the canonical run/setup/teardown/onError envelope.
 * Lets registry tasks declare lifecycle hooks without each one re-inventing
 * try/finally inside `run()`.
 */
function wrapLifecycle(buildTask: BuildTask) {
  if (!buildTask.setup && !buildTask.teardown && !buildTask.onError) {
    return buildTask.run;
  }
  return async (ctx: TaskRunContext) => {
    let caught: unknown = undefined;
    try {
      if (buildTask.setup) {
        ctx.markPhase("setup");
        await buildTask.setup(ctx);
      }
      ctx.markPhase("run");
      await buildTask.run(ctx);
    } catch (e) {
      caught = e;
      if (buildTask.onError) {
        try {
          ctx.markPhase("onError");
          await buildTask.onError(e, ctx);
        } catch (hookErr) {
          ctx.logger.warn(`[onError hook threw] ${hookErr}`);
        }
      }
    } finally {
      if (buildTask.teardown) {
        try {
          ctx.markPhase("teardown");
          await buildTask.teardown(ctx);
        } catch (hookErr) {
          ctx.logger.warn(`[teardown hook threw] ${hookErr}`);
        }
      }
    }
    if (caught) throw caught;
  };
}

export function defineDropTask(buildTask: BuildTask): DropTask {
  const wrappedRun = wrapLifecycle(buildTask);
  // Wrap the run with a dedup guard at create-time. We can't enforce
  // it here (the handler doesn't exist yet), so we attach the key
  // function and let `create()` consult it. Done as a closure so
  // call sites that go through `taskHandler.create({...defineDropTask(x).build()})`
  // also get dedup.
  return {
    taskGroup: buildTask.taskGroup,
    schedule: buildTask.schedule,
    build: () => ({
      id: buildTask.buildId(),
      taskGroup: buildTask.taskGroup,
      name: buildTask.name,
      run: wrappedRun,
      acls: buildTask.acls,
      initialActions: buildTask.initialActions ?? [],
      // The dedup key is consumed by `create()` via the task.key field.
      // We default to per-group so single-flight is the norm (group
      // concurrency:false already enforces the same thing, but `key`
      // lets us short-circuit the check earlier and produces a clearer
      // error). Pass `dedupKey: () => undefined` (or omit the field
      // and customise in your own implementation) to opt out.
      key: buildTask.dedupKey
        ? buildTask.dedupKey()
        : `dropTask:${buildTask.taskGroup}`,
    }),
  };
}

export const taskHandler = new TaskHandler();
export default taskHandler;
