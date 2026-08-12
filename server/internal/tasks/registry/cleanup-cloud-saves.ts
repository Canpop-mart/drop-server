import { defineDropTask } from "..";
import {
  TOMBSTONE_RETENTION_MS,
  countTombstonesDue,
  formatBytes,
  gcSaveRevisions,
  gcTombstones,
} from "../../cloudsaves/quota";

/**
 * Reclaims cloud-save storage that nothing else ever frees.
 *
 * Two passes:
 *   1. Tombstones past the 30-day retention window get hard-deleted. Until
 *      this task existed, `delete.post.ts` only ever set `deletedAt`, so
 *      every save a user had "deleted" still sat in Postgres with its blob
 *      intact, forever.
 *   2. Surplus revisions get trimmed back to the newest N per save. The
 *      upload path prunes as it writes, so this normally finds nothing —
 *      it catches concurrent uploads that each snapshotted the same version.
 *
 * Order matters: purging tombstones first cascades their revisions away, so
 * pass 2 walks a smaller set.
 *
 * Deliberately does NOT age out revisions of live saves. See
 * `gcSaveRevisions` for why.
 *
 * ## Pass 1 is opt-in, and off the daily schedule
 *
 * The tombstone purge is the only operation in the cloud-save feature that
 * destroys bytes with no backup, no history and no undo. It has also never
 * run: `gcTombstones` had no call sites before this task, so on the first
 * execution EVERY save the user has ever deleted qualifies at once, and those
 * rows predate CloudSaveRevision so there is nothing to restore them from.
 *
 * So it reports by default. Set `DROP_CLOUD_SAVE_GC=apply` once you have seen
 * the count in the task log and are happy to lose those rows; only then is it
 * reasonable to add `cleanup:cloud-saves` back to `dailyScheduledTasks` in
 * `internal/tasks/index.ts`. Pass 2 always runs — it only ever removes
 * surplus copies of a version, never the live save.
 */
const RETENTION_DAYS = Math.round(
  TOMBSTONE_RETENTION_MS / (24 * 60 * 60 * 1000),
);

/** True only for an explicit opt-in to the destructive tombstone purge. */
function purgeEnabled(): boolean {
  return process.env.DROP_CLOUD_SAVE_GC?.trim().toLowerCase() === "apply";
}

export default defineDropTask({
  buildId: () => `cleanup:cloud-saves:${new Date().toISOString()}`,
  name: "Purge Deleted Cloud Saves",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:cloud-saves",

  async run({ progress, logger }) {
    const due = await countTombstonesDue();
    logger.info(
      `${due.count} tombstoned save(s) older than ${RETENTION_DAYS}d, ` +
        `holding ${formatBytes(due.bytes)}`,
    );
    progress(30);

    if (!purgeEnabled()) {
      logger.info(
        "Report only. These rows were NOT deleted. Set DROP_CLOUD_SAVE_GC=apply to purge them.",
      );
    } else {
      const purged = await gcTombstones();
      logger.info(
        `Hard-deleted ${purged} tombstoned save(s) and their history`,
      );
    }
    progress(60);

    const trimmed = await gcSaveRevisions();
    logger.info(`Trimmed ${trimmed} surplus revision(s)`);
    progress(100);
  },
});
