import { ArkErrors, type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { aclManager } from "~/server/internal/acls";
import { libraryManager } from "~/server/internal/library";
import { taskHandler, wrapTaskContext } from "~/server/internal/tasks";
import { pickLaunchesFromPreload } from "~/server/internal/library/import/pickLaunches";
import type { ImportReceiptShape } from "~/server/internal/library/import/types";

const MassImport = type({
  versions: type({
    id: "string",
    version: type({
      type: "'depot' | 'local'",
      identifier: "string",
      name: "string",
    }),
    displayName: "string?",
    setupMode: "boolean = false",
  }).array(),
}).configure(throwingArktype);

const MassImportQuery = type({
  dryRun: "string?",
});

/**
 * Max number of version imports to run at once. Default 2; override
 * with the DROP_MASS_IMPORT_CONCURRENCY env var. Clamped to 1..8.
 */
function massImportConcurrency(): number {
  const raw = Number(process.env.DROP_MASS_IMPORT_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(8, Math.floor(raw));
}

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = MassImportQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, message: query.summary });
  const dryRun = query.dryRun === "true" || query.dryRun === "1";

  const body = await readDropValidatedBody(h3, MassImport);

  /** Resolves launches for one entry from its preload result. */
  const resolveEntry = async (
    entry: (typeof body.versions)[number],
  ): Promise<
    | { ok: true; launches: ReturnType<typeof pickLaunchesFromPreload> }
    | { ok: false; reason: string }
  > => {
    const preload = await libraryManager.fetchUnimportedVersionInformation(
      entry.id,
      entry.version,
    );
    if (!preload)
      return {
        ok: false,
        reason: `failed to fetch preload information for ${entry.version.name}`,
      };
    if (preload.length === 0)
      return {
        ok: false,
        reason: `no auto-discovered executables for ${entry.version.name}`,
      };
    return {
      ok: true,
      launches: pickLaunchesFromPreload(preload, entry.setupMode),
    };
  };

  // ── Dry-run: plan every version synchronously, write nothing ─────────
  if (dryRun) {
    const receipts: Array<
      | { version: string; receipt: ImportReceiptShape }
      | { version: string; error: string }
    > = [];
    for (const entry of body.versions) {
      const resolved = await resolveEntry(entry);
      if (!resolved.ok) {
        receipts.push({ version: entry.version.name, error: resolved.reason });
        continue;
      }
      try {
        const receipt = await libraryManager.dryRunVersionImport(
          entry.id,
          entry.version,
          {
            id: entry.id,
            version: entry.version,
            displayName: entry.displayName,
            launches: resolved.launches.launches,
            setups: resolved.launches.setups,
            onlySetup: entry.setupMode,
            delta: false,
            requiredContent: [],
          },
        );
        if (!receipt) {
          receipts.push({
            version: entry.version.name,
            error: "invalid game/library",
          });
        } else {
          receipts.push({ version: entry.version.name, receipt });
        }
      } catch (e) {
        receipts.push({
          version: entry.version.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { dryRun: true, receipts };
  }

  const concurrency = massImportConcurrency();

  const taskId = await taskHandler.create({
    key: "mass-import",
    taskGroup: "import:version",
    acls: ["system:import:version:read"],
    name: `Mass-importing ${body.versions.length} version(s) (concurrency ${concurrency})`,
    async run({ progress, logger, addAction, markPhase, signal }) {
      const total = body.versions.length;
      let completed = 0;

      logger.info(
        `[mass-import] Importing ${total} version(s) with up to ${concurrency} concurrent`,
      );

      // Bounded worker pool: `cursor` hands out the next index, workers
      // pull until exhausted. Each version gets its own progress band.
      let cursor = 0;
      const runWorker = async (workerId: number) => {
        for (;;) {
          if (signal.aborted) {
            logger.warn(`[mass-import] Worker ${workerId} aborting`);
            return;
          }
          const index = cursor++;
          if (index >= total) return;
          const entry = body.versions[index];

          const resolved = await resolveEntry(entry);
          if (!resolved.ok) {
            logger.warn(`[mass-import] Skipping #${index}: ${resolved.reason}`);
            completed++;
            progress((completed / total) * 100);
            continue;
          }

          logger.info(
            `[mass-import] (#${index}) importing ${entry.version.name}`,
          );
          try {
            await libraryManager.importVersion(
              entry.id,
              entry.version,
              {
                id: entry.id,
                version: entry.version,
                displayName: entry.displayName,
                launches: resolved.launches.launches,
                setups: resolved.launches.setups,
                onlySetup: entry.setupMode,
                delta: false,
                requiredContent: [],
              },
              wrapTaskContext(
                { logger, progress, addAction, markPhase, signal },
                {
                  // Each version maps onto an equal slice of 0..100 so
                  // the bar advances regardless of completion order.
                  min: (index / total) * 100,
                  max: ((index + 1) / total) * 100,
                  prefix: entry.version.name,
                },
              ),
            );
            logger.info(
              `[mass-import] (#${index}) finished ${entry.version.name}`,
            );
          } catch (e) {
            logger.warn(
              `[mass-import] (#${index}) failed ${entry.version.name}: ${e}`,
            );
          }
          completed++;
          progress((completed / total) * 100);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, total) }, (_, i) =>
          runWorker(i),
        ),
      );
      progress(100);
      logger.info(`[mass-import] Done — ${completed}/${total} processed`);
    },
  });

  return { taskId };
});
