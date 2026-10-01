/*
The purpose of this class is to hold references to remote objects (like
images) until they're actually needed. This is used as a utility in
metadata handling and HTTP upload paths, so we only fetch / persist the
objects if we're actually creating a database record.

2026 audit fix
──────────────
Previously `dump()` only cleared the in-memory map. That's correct for
the "we never pulled" path (caller bailed before persisting), but most
call sites use the pattern:

    const [add, pull, dump] = transactional.new(...);
    pull();                          // → objects are now on disk
    const result = await prisma.x.updateMany({ ... });
    if (result.count === 0) {
      dump();                        // ← used to be a no-op leak
      throw createError({ ... });
    }

`pull()` writes the objects to the backend immediately, so a post-pull
dump was leaving orphaned files on disk waiting for the GC sweep to
notice. Now `dump()` tracks which ids have been pulled and removes
them from the backend on-call. The GC sweep is still the safety net,
but the happy path no longer relies on it.

Dead remote assets
──────────────────
`pull()` used to abort the whole loop on the first fetch error, so a
single stale URL from an upstream provider killed an entire game
import. It now walks every object, cleans up after each failure, and
reports what it could not fetch. Callers that can reconcile their
payload (the game importer) pass `{ tolerateFailures: true }` and prune
or replace the failed ids before writing any row. Everyone else keeps
all-or-nothing semantics. Either way a pull where *nothing* succeeded
still throws, because that is a network or storage outage rather than
one bad URL.
*/
import type { Readable } from "stream";
import { randomUUID } from "node:crypto";
import objectHandler from ".";
import type { TaskRunContext } from "../tasks";

export type TransactionDataType = string | Readable | Buffer;
type TransactionEntry = {
  data: TransactionDataType;
  pulled: boolean;
  failed: boolean;
};
type TransactionTable = Map<string, TransactionEntry>; // ID to entry
type GlobalTransactionRecord = Map<string, TransactionTable>; // Transaction ID to table

/** One object that could not be fetched or written during `pull()`. */
export type PullFailure = {
  /** The object id that was handed out by `register()`. */
  id: string;
  /** The URL we tried to fetch, or "raw data" for Buffer / stream sources. */
  source: string;
  /** Why it failed, already flattened to a string for logging. */
  reason: string;
};

export type PullResult = {
  /** How many objects this call actually attempted (skips ones already pulled). */
  attempted: number;
  /** How many landed in the object store. */
  pulled: number;
  /** Everything that did not land. Empty on the happy path. */
  failures: PullFailure[];
};

export type PullOptions = {
  /**
   * When false (the default) a single bad object fails the whole pull, which
   * is what every all-or-nothing caller wants: uploads, generated icons,
   * single-object backfills.
   *
   * When true the caller takes responsibility for reconciling the returned
   * failures before it writes any ids to the database. Only the game-import
   * path does this, because one dead Steam screenshot hash should not throw
   * away a whole game.
   */
  tolerateFailures?: boolean;
};

export type Register = (url: TransactionDataType) => string;
export type Pull = (options?: PullOptions) => Promise<PullResult>;
export type Dump = () => Promise<void>;

export class ObjectTransactionalHandler {
  private record: GlobalTransactionRecord = new Map();

  new(
    metadata: { [key: string]: string },
    permissions: Array<string>,
    context?: TaskRunContext,
  ): [Register, Pull, Dump] {
    const transactionId = randomUUID();

    this.record.set(transactionId, new Map());

    const register = (data: TransactionDataType) => {
      const objectId = randomUUID();
      this.record
        .get(transactionId)
        ?.set(objectId, { data, pulled: false, failed: false });

      return objectId;
    };

    const pull = async (options?: PullOptions) => {
      const transaction = this.record.get(transactionId);
      const result: PullResult = { attempted: 0, pulled: 0, failures: [] };
      if (!transaction) return result;

      // Retries only cover what is still outstanding. Entries that already
      // landed stay put, and entries that already failed are not re-fetched,
      // so a caller can register replacement objects and pull again without
      // walking into the same dead URL a second time.
      const pending = [...transaction].filter(
        ([, entry]) => !entry.pulled && !entry.failed,
      );
      if (pending.length === 0) return result;

      // Progress is measured against the whole table, not just this
      // call's pending slice, so a follow-up pull for replacement objects
      // does not send the bar back to zero.
      const settled = () =>
        [...transaction].filter(([, e]) => e.pulled || e.failed).length;

      for (const [id, entry] of pending) {
        const data = entry.data;
        const source = typeof data === "string" ? data : "raw data";
        if (typeof data === "string") {
          context?.logger.info(`Importing object from "${data}"`);
        } else {
          context?.logger.info(`Importing raw object...`);
        }
        result.attempted += 1;
        try {
          await objectHandler.createFromSource(
            id,
            () => {
              if (typeof data === "string") {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore Route-registry type inference exceeds TS's depth limit (TS2589)
                return $fetch<Readable>(data, { responseType: "stream" });
              }
              return (async () => data)();
            },
            metadata,
            permissions,
          );
          entry.pulled = true;
          result.pulled += 1;
        } catch (e) {
          entry.failed = true;
          const reason = e instanceof Error ? e.message : String(e);
          result.failures.push({ id, source, reason });
          // `createFromSource` can throw after the backend has already
          // written the metadata file and opened the payload (fsBackend
          // writes both before streaming). Delete unconditionally so a
          // half-written object never survives; if nothing was created
          // this is a no-op.
          await objectHandler.deleteAsSystem(id).catch(() => undefined);
          context?.logger.warn(
            typeof data === "string"
              ? `Could not download an image from ${data}. Reason: ${reason}. Skipping this image and continuing.`
              : `Could not save an image to the object store. Reason: ${reason}. Skipping this image and continuing.`,
          );
        }
        context?.progress((settled() / transaction.size) * 100);
      }

      if (result.failures.length === 0) return result;

      const summary = result.failures
        .map((f) => `${f.source} (${f.reason})`)
        .join(", ");

      // Nothing at all came through. That reads as the object store or the
      // network being down rather than one stale remote hash, and a record
      // whose art is entirely placeholder is worse than a task the operator
      // can see failed and re-run. Fail loudly.
      if (result.pulled === 0)
        throw new Error(
          `None of the ${result.attempted} images could be imported, so this looks like a network or storage problem rather than one missing image. Failures: ${summary}`,
        );

      if (!options?.tolerateFailures)
        throw new Error(
          `${result.failures.length} of ${result.attempted} images could not be imported. Failures: ${summary}`,
        );

      return result;
    };

    const dump = async () => {
      const transaction = this.record.get(transactionId);
      if (!transaction) return;
      // Anything already on disk via pull() needs an actual backend
      // delete, otherwise the file leaks until GC sweeps it. Cancelled
      // before pull() = just clear the map.
      for (const [id, entry] of transaction) {
        if (entry.pulled) {
          await objectHandler.deleteAsSystem(id).catch(() => undefined);
        }
      }
      this.record.delete(transactionId);
    };

    return [register, pull, dump];
  }
}
