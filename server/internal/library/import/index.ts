/**
 * Version-import orchestrator.
 *
 * `runVersionImport` is the ~40-line conductor that the old ~200-line
 * `importVersion` closure decomposed into. It builds an `ImportContext`,
 * then drives the five phases in order, emitting `ctx.markPhase()` for
 * each so the task log is phase-labelled:
 *
 *   directory → emulator → manifest → validate → persist
 *
 * Each phase lives in `server/internal/library/import/<phase>.ts` and is
 * a pure-ish function over the context.
 *
 * On `dryRun` the phases plan but never touch the DB or filesystem;
 * the orchestrator returns a receipt-shaped object without persisting.
 *
 * A `ManifestValidationError` from the validate phase propagates out so
 * the GameVersion row is never written for a broken import.
 */

import { prepareVersionDirectory } from "./prepareVersionDirectory";
import { setupEmulators } from "./setupEmulators";
import { generateManifest } from "./generateManifest";
import { validateManifest } from "./validateManifest";
import { persistVersion } from "./persistVersion";
import type {
  ImportContext,
  ImportReceiptShape,
  EmulatorSetupResult,
} from "./types";

/** A recorded phase span, kept for the ImportReceipt. */
interface PhaseSpan {
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

/**
 * Wraps `ctx.task.markPhase` so each phase also gets a timed span for
 * the structured ImportReceipt. The task system records its own phase
 * list in TaskReceipt.progressLog; this is the import-specific copy.
 */
class PhaseRecorder {
  readonly spans: PhaseSpan[] = [];
  private open: { name: string; startedAt: number } | null = null;

  constructor(private readonly ctx: ImportContext) {}

  enter(name: string) {
    this.close();
    this.open = { name, startedAt: Date.now() };
    this.ctx.task.markPhase(name);
    this.ctx.logger.info(`[PHASE:${name}] start`);
  }

  close() {
    if (!this.open) return;
    const endedAt = Date.now();
    this.spans.push({
      name: this.open.name,
      startedAt: new Date(this.open.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - this.open.startedAt,
    });
    this.open = null;
  }
}

/**
 * Runs the full import pipeline for one version.
 *
 * Returns the receipt-shaped result. For a real import the
 * `ImportReceipt` row is also written (by the persist phase). For a
 * dry-run nothing is persisted and `gameVersionId` is null.
 */
export async function runVersionImport(
  ctx: ImportContext,
): Promise<ImportReceiptShape> {
  const phases = new PhaseRecorder(ctx);

  // ── 1. directory ─────────────────────────────────────────────────────
  phases.enter("directory");
  const prepared = await prepareVersionDirectory(ctx);

  // ── 2. emulator (swap happens here, BEFORE the manifest) ─────────────
  phases.enter("emulator");
  const emulators: EmulatorSetupResult = await setupEmulators(
    ctx,
    prepared.versionDir,
  );

  // ── 3. manifest (single pass, post-swap bytes) ───────────────────────
  phases.enter("manifest");
  const manifestResult = await generateManifest(ctx, prepared);

  // ── 4. validate (throws ManifestValidationError → no row written) ────
  phases.enter("validate");
  const validation = await validateManifest(ctx, prepared, manifestResult);

  // ── 5. persist (skipped entirely for dry-run) ────────────────────────
  let gameVersionId: string | null = null;
  if (ctx.dryRun) {
    phases.enter("persist");
    ctx.logger.info("[PHASE:persist] dry-run — nothing persisted");
    phases.close();
  } else {
    phases.enter("persist");
    // PhaseRecorder.spans is finalised after persist; persistVersion
    // receives the spans collected so far plus its own (closed below).
    const persistResult = await persistVersion(
      ctx,
      prepared,
      manifestResult,
      validation,
      emulators,
      // Snapshot of completed spans — persist's own span is appended by
      // close() right after, but the receipt write happens inside
      // persist, so we pass spans-so-far. Good enough: persist timing is
      // dominated by the insert which we don't need sub-ms accuracy for.
      phases.spans,
    );
    gameVersionId = persistResult.versionId;
    phases.close();
  }

  ctx.task.progress(100);

  return {
    gameId: ctx.gameId,
    gameVersionId,
    phaseTimings: phases.spans,
    fileCount: validation.fileCount,
    totalSizeBytes: validation.totalSizeBytes,
    chunkCount: validation.chunkCount,
    dllSwapApplied: emulators.dllSwapApplied,
    dllSwapName: emulators.dllSwapName,
    warnings: ctx.warnings,
    dryRun: ctx.dryRun,
  };
}

export { ManifestValidationError } from "./types";
export type { ImportContext, ImportReceiptShape } from "./types";
