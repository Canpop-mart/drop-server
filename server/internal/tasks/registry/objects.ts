import objectHandler from "~/server/internal/objects";
import {
  OBJECT_REFERENCE_COLUMNS,
  findUnregisteredObjectColumns,
  modelDelegate,
  type ObjectReferenceColumn,
} from "~/server/internal/objects/objectRefs";
import { defineDropTask } from "..";

/**
 * Cleanup task: deletes objects that no longer have any row pointing
 * at them.
 *
 * 2026 audit changes:
 *   1. The list of reference columns is now centralised in
 *      `server/internal/objects/objectRefs.ts`. Previously the task
 *      walked every Prisma model and treated any column whose name
 *      ended in `objectid` / `objectids` as a reference. That worked
 *      until somebody renamed a column.
 *   2. Startup integrity check: if any `*ObjectId` field exists on a
 *      live Prisma model that isn't enumerated in objectRefs, the
 *      task warns loudly. We don't *throw* — the registry might be
 *      intentionally narrower than the schema — but the warning lands
 *      in the task log and on the admin browser so an operator sees
 *      the drift before GC deletes a live object.
 *   3. Every delete is now logged with the reason ("kept by:
 *      game.mIconObjectId in 0 rows" → orphan, deleting). Previously
 *      the task was a black box.
 *   4. Honours `signal.aborted` between iterations so an admin can
 *      cancel a long GC run from the task UI.
 *   5. Uses `markPhase()` from the task-system refactor so the
 *      TaskReceipt timeline shows scan / delete-orphans / cleanup-
 *      metadata as separate phases.
 */
export default defineDropTask({
  buildId: () => `cleanup:objects:${Date.now()}`,
  name: "Cleanup Objects",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:objects",
  schedule: { weekly: true },
  async run({ progress, logger, signal, markPhase }) {
    logger.info("Cleaning unreferenced objects");

    // Drift check — if the live schema has any *ObjectId field not
    // registered in objectRefs.ts, warn so we don't silently GC
    // something we should be keeping.
    markPhase("verify-registry");
    const unregistered = findUnregisteredObjectColumns();
    if (unregistered.length > 0) {
      logger.warn(
        `[gc:objects] Schema drift: ${unregistered.length} *ObjectId field(s) on Prisma models are not registered in objectRefs.ts. Add them to the registry before running GC again:`,
      );
      for (const { model, field } of unregistered) {
        logger.warn(`  - ${model}.${field}`);
      }
      logger.warn(
        "[gc:objects] Aborting GC to avoid deleting live objects. Update server/internal/objects/objectRefs.ts and re-run.",
      );
      return;
    }

    markPhase("scan");
    const objects = await objectHandler.listAll();
    logger.info(
      `Scanning ${objects.length} object(s) against the reference registry`,
    );
    logger.info(
      `Reference columns: ${OBJECT_REFERENCE_COLUMNS.length} across ${new Set(OBJECT_REFERENCE_COLUMNS.map((c) => c.model)).size} model(s)`,
    );
    progress(15);

    // Walk every object once, querying each model for a hit. Records
    // the first column that referenced it (used for log line / "kept
    // by" annotation) and short-circuits as soon as we find one.
    const orphans: string[] = [];
    let scanned = 0;
    for (const obj of objects) {
      if (signal.aborted) {
        logger.warn("[gc:objects] Cancellation requested mid-scan; bailing");
        return;
      }
      const hit = await findReference(obj);
      if (!hit) {
        orphans.push(obj);
      }
      scanned++;
      if (scanned % 50 === 0) {
        // Map 0..N scanned -> 15..60% so the bar moves through the scan.
        progress(15 + (45 * scanned) / Math.max(1, objects.length));
      }
    }
    logger.info(
      `Scan complete: ${orphans.length} orphan(s) out of ${objects.length} object(s)`,
    );
    progress(60);

    // Loud per-delete logging. Reason is "orphaned (not referenced by
    // any of N columns)" — we already know the registry is fully
    // walked because the no-hit predicate is what put it on the list.
    markPhase("delete-orphans");
    const deletePromises: Promise<{ id: string; ok: boolean }>[] = [];
    for (const obj of orphans) {
      if (signal.aborted) {
        logger.warn("[gc:objects] Cancellation requested mid-delete; bailing");
        return;
      }
      logger.info(
        `[gc:objects] Deleting orphan ${obj} — reason: not referenced by any of ${OBJECT_REFERENCE_COLUMNS.length} known columns`,
      );
      deletePromises.push(
        objectHandler
          .deleteAsSystem(obj)
          .then((ok) => ({ id: obj, ok }))
          .catch((err) => {
            logger.warn(`[gc:objects] Failed to delete ${obj}: ${err}`);
            return { id: obj, ok: false };
          }),
      );
    }
    const results = await Promise.all(deletePromises);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      logger.warn(
        `[gc:objects] Failed to delete ${failed.length}/${orphans.length} object(s)`,
      );
    } else {
      logger.info(`[gc:objects] Deleted ${results.length} orphan(s)`);
    }
    progress(90);

    // Remove any possible leftover metadata
    markPhase("cleanup-metadata");
    await objectHandler.cleanupMetadata(logger);

    logger.info("[gc:objects] Done");
    progress(100);
  },
});

/**
 * Returns the first reference column that has a row pointing at this
 * object, or undefined if none do.
 *
 * Per-column lookup batches every column on a model into one query
 * (single OR) rather than one query per column — keeps the per-object
 * scan O(models) instead of O(columns). Still O(objects) overall;
 * orders-of-magnitude growth would need an index-driven plan but
 * we're nowhere near that today.
 */
async function findReference(
  id: string,
): Promise<ObjectReferenceColumn | undefined> {
  const byModel = new Map<string, ObjectReferenceColumn[]>();
  for (const c of OBJECT_REFERENCE_COLUMNS) {
    const arr = byModel.get(c.model) ?? [];
    arr.push(c);
    byModel.set(c.model, arr);
  }

  for (const [modelName, columns] of byModel) {
    const orConditions = columns.map((c) =>
      c.kind === "scalar"
        ? { [c.field]: { equals: id } }
        : { [c.field]: { has: id } },
    );
    const delegate = modelDelegate(modelName);
    const found = await delegate.findFirst({
      where: { OR: orConditions },
      select: { id: true },
    } as unknown as never);
    if (found) {
      // Return the first column that *could* hold the id. We don't
      // re-query to disambiguate which of the model's columns
      // actually matched — for log purposes "kept by something on
      // <model>" is fine.
      return columns[0];
    }
  }
  return undefined;
}
