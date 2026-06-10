import taskHandler from ".";
import { logger } from "../logging";
import type { TaskGroup } from "./group";

/**
 * Declarative scheduler. Walks every registered DropTask and, if it
 * declares a `schedule`, registers a recurring trigger.
 *
 * Two flavours are honoured today (see DropTaskSchedule in `./index.ts`):
 *   - `{ intervalMs }`: setInterval-based polling. The first run happens
 *     on the next tick, then every intervalMs after.
 *   - `{ daily }` / `{ weekly }`: bucketed into the legacy daily/weekly
 *     scheduler so the behaviour for tasks already on that path is
 *     unchanged (cleanup:auth-records, check:update, cleanup:objects,
 *     scan:library-integrity).
 *
 * Single-flight + concurrency:false in the task pool prevent overlap if
 * a previous run is still in flight when the timer fires.
 */
class TaskScheduler {
  private timers: NodeJS.Timeout[] = [];
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    const registry = taskHandler.getRegisteredTasks();
    let intervalCount = 0;
    for (const [group, task] of registry) {
      if (!task.schedule) continue;
      if ("intervalMs" in task.schedule) {
        this.registerInterval(group, task.schedule.intervalMs);
        intervalCount++;
      }
      // daily/weekly schedules are handled by the existing
      // triggerDailyTasks() path in TaskHandler — we don't need to
      // re-register them here. They still fire at boot via the
      // `server/tasks/dailyTasks.ts` nitro task and on the nitro
      // schedule defined in nuxt config.
    }

    if (intervalCount > 0) {
      logger.info(
        `[scheduler] Registered ${intervalCount} interval-based task(s)`,
      );
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.started = false;
  }

  private registerInterval(group: TaskGroup, intervalMs: number) {
    const fire = async () => {
      try {
        // hasTaskKey check is the cheap path; concurrency:false in the
        // pool handles the race-condition case.
        await taskHandler.runTaskGroupByName(group);
      } catch (e) {
        // The handler already logs failures; we just don't want a
        // timer to die from an uncaught rejection.
        logger.warn(`[scheduler] ${group} fire failed: ${e}`);
      }
    };
    const handle = setInterval(fire, intervalMs);
    this.timers.push(handle);
    logger.info(
      `[scheduler] ${group}: every ${(intervalMs / 1000).toFixed(0)}s`,
    );
  }
}

export const taskScheduler = new TaskScheduler();
export default taskScheduler;
