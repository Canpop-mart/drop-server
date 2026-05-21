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
*/
import type { Readable } from "stream";
import { randomUUID } from "node:crypto";
import objectHandler from ".";
import type { TaskRunContext } from "../tasks";

export type TransactionDataType = string | Readable | Buffer;
type TransactionEntry = {
  data: TransactionDataType;
  pulled: boolean;
};
type TransactionTable = Map<string, TransactionEntry>; // ID to entry
type GlobalTransactionRecord = Map<string, TransactionTable>; // Transaction ID to table

export type Register = (url: TransactionDataType) => string;
export type Pull = () => Promise<void>;
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
      this.record.get(transactionId)?.set(objectId, { data, pulled: false });

      return objectId;
    };

    const pull = async () => {
      const transaction = this.record.get(transactionId);
      if (!transaction) return;

      let progress = 0;
      const increment = 100 / transaction.size;

      for (const [id, entry] of transaction) {
        if (entry.pulled) continue;
        const data = entry.data;
        if (typeof data === "string") {
          context?.logger.info(`Importing object from "${data}"`);
        } else {
          context?.logger.info(`Importing raw object...`);
        }
        await objectHandler.createFromSource(
          id,
          () => {
            if (typeof data === "string") {
              return $fetch<Readable>(data, { responseType: "stream" });
            }
            return (async () => data)();
          },
          metadata,
          permissions,
        );
        entry.pulled = true;
        progress += increment;
        context?.progress(progress);
      }
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
