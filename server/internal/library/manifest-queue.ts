/**
 * Queue manifest regenerations for changed game versions, hashed one at a
 * time by a single background worker task.
 *
 * Used where files under a version directory change inside an HTTP request
 * (the admin achievement scan): hashing a whole game there would hold the
 * request open for minutes, and a bulk scan that hashed every changed game
 * at once would saturate the NAS. The request only adds the version to the
 * queue; the worker (visible in the admin Tasks panel) drains it in order.
 *
 * Per-version semantics: a version queued again while it is being hashed is
 * put back on the queue, so it is hashed once more after the current pass
 * and the stored manifest always matches the last write. A version queued
 * twice while waiting is hashed once.
 *
 * At most one worker exists at a time, enforced here (`workerActive`), not by
 * the task group: the group allows concurrency so that starting a new worker
 * never collides with a finished one the task pool hasn't removed yet (with
 * concurrency off, `create` refuses during that window and the change would
 * be lost). `regenerateManifestForLatestVersion` also serialises per version,
 * so the library-wide "Regenerate Manifests" task can't hash the same version
 * at the same time as this worker.
 */
import taskHandler from "~/server/internal/tasks";
import { logger } from "~/server/internal/logging";
import { libraryManager } from ".";

/** versionId -> gameId, in the order they were queued. */
const queue = new Map<string, string>();
let workerActive = false;

/**
 * Adds a version to the regeneration queue and makes sure the worker is
 * running. Returns the worker's task id when this call started it, or null
 * when a worker was already running (it will get to this version) or could
 * not be started (logged; the next queue call tries again).
 */
export async function queueManifestRegeneration(
  gameId: string,
  versionId: string,
  reason: string,
): Promise<string | null> {
  queue.set(versionId, gameId);
  logger.info(
    `[MANIFEST] Queued regeneration of version ${versionId} (${reason}); ${queue.size} waiting`,
  );
  return ensureWorker();
}

async function ensureWorker(): Promise<string | null> {
  if (workerActive) return null;
  workerActive = true;
  try {
    return await taskHandler.create({
      taskGroup: "regenerate:manifest-version",
      acls: ["system:maintenance:read"],
      name: "Regenerate changed manifests",
      async run({ progress, logger: taskLogger }) {
        let done = 0;
        let failed = 0;
        try {
          while (queue.size > 0) {
            const [versionId, gameId] = queue.entries().next().value!;
            queue.delete(versionId);
            let ok = false;
            try {
              ok = await libraryManager.regenerateManifestForLatestVersion(
                gameId,
                taskLogger,
                { versionId },
              );
            } catch (e) {
              taskLogger.warn(
                `Manifest regen threw for version ${versionId}: ${e}`,
              );
            }
            if (ok) done++;
            else failed++;
            progress(
              Math.round(
                ((done + failed) / (done + failed + queue.size)) * 100,
              ),
            );
          }
          taskLogger.info(
            `Regenerated ${done} manifest(s)` +
              (failed > 0
                ? `; ${failed} NOT regenerated (see above). Clients may fail checksum ` +
                  `validation for those until "Regenerate Manifests" runs.`
                : ""),
          );
          progress(100);
        } finally {
          // Synchronous with the loop's last empty check, so nothing can be
          // queued in between and left without a worker.
          workerActive = false;
        }
      },
    });
  } catch (e) {
    workerActive = false;
    logger.warn(
      `[MANIFEST] Could not start the manifest regeneration worker: ${e}. ` +
        `${queue.size} version(s) still queued; the next change retries, or run "Regenerate Manifests".`,
    );
    return null;
  }
}
