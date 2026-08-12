/**
 * Who may READ whose cloud saves.
 *
 * Drop stores two kinds of save and they have different owners:
 *
 *   - Emulator saves (`saveType` "save" / "state") live under
 *     `drop-saves/{userId}/` on the client. A file there belongs to exactly
 *     one account, so only that account reads it.
 *
 *   - PC game saves (`saveType` "pc") are found by where the game writes them
 *     on this computer — Ludusavi looks in `%APPDATA%`, `Documents`, the Steam
 *     userdata folder. None of that depends on who is signed in to Drop. Two
 *     accounts playing the same PC game on one machine are reading and writing
 *     the same bytes on disk, so keeping their cloud rows apart would only
 *     mean each account silently loses the other's progress.
 *
 * The split is READ-ONLY, and this module is the only place on the server that
 * knows about it. Writes stay keyed on `(gameId, userId, filename)`: an upload
 * upserts only the caller's own row, and a delete tombstones only the caller's
 * own row (see `delete.post.ts`). One account can shadow another's PC save in
 * a read; it can never overwrite or delete it.
 *
 * `saveType` is client-supplied and there is no game-ownership check on
 * upload, so "it says pc" is not on its own a reason to hand a row to another
 * account. A shared row must also carry the client's PC namespace in its
 * filename (see {@link isPcNamespacedFilename}) — without that gate, any
 * account could plant a row named like an emulator save against an emulator
 * game's id and have another account's launch write it straight into that
 * person's own per-user save directory.
 *
 * The visible consequence of sharing: deleting a shared PC save removes your
 * row only. If another account on this server still holds an active row for
 * the same filename, that row is what your next read returns, and the save
 * comes back. The client UI says so out loud.
 */

/** The one `saveType` that is shared across accounts on this server. */
export const SHARED_SAVE_TYPE = "pc";

/**
 * Prefixes the client puts on a PC save's filename. `pc__` is current; `pc/`
 * is the original, kept because rows uploaded under it still exist. Emulator
 * saves never carry either.
 */
const PC_FILENAME_PREFIXES = ["pc__", "pc/"];

/** Whether a filename was written by the client's PC-save encoder. */
export function isPcNamespacedFilename(filename: string): boolean {
  return PC_FILENAME_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

/**
 * Prisma `where` fragment for "rows this user could be allowed to read": their
 * own, plus every account's PC saves. Compose it with `gameId` / `deletedAt` /
 * `id` as needed.
 *
 * This is the coarse half. Prisma cannot express the filename-namespace gate,
 * so every caller must still run the rows through {@link isReadableSave} or
 * {@link collapseByFilename}.
 */
export function readableSaveScope(userId: string) {
  return { OR: [{ userId }, { saveType: SHARED_SAVE_TYPE }] };
}

/** Row-level form of {@link readableSaveScope}, for single-row lookups. */
export function isReadableSave(
  save: { userId: string; saveType: string; filename: string },
  userId: string,
): boolean {
  if (save.userId === userId) return true;
  return (
    save.saveType === SHARED_SAVE_TYPE && isPcNamespacedFilename(save.filename)
  );
}

/**
 * The clock-skew tolerance the upload endpoints already allow on a
 * client-supplied `clientModifiedAt`. Two rows inside the same window of this
 * size are treated as "modified at about the same time".
 */
const CLOCK_SKEW_BUCKET_MS = 5 * 60 * 1000;

interface CollapsibleSave {
  id: string;
  userId: string;
  user: { displayName: string };
  filename: string;
  clientModifiedAt: Date;
  uploadedAt: Date;
}

/** One filename's worth of rows, resolved down to what a client is told. */
export interface CollapsedSave<T> {
  /** The row every client keys on for this filename. */
  winner: T;
  /** The caller's own row, when it lost the collision. */
  shadowedOwn: T | null;
  /**
   * Display names of the other accounts holding this filename, excluding the
   * winner's and the caller's own. Non-empty means a second copy of this save
   * exists that the caller is not looking at.
   */
  alsoHeldBy: string[];
}

/**
 * Collapse rows that share a filename down to one winner, without hiding the
 * caller's own row from them.
 *
 * Once PC saves are read across accounts, two users can hold a row for the
 * same filename of the same game. The client keys its entire save model on the
 * filename, so it must be handed exactly one row per name — but "one row per
 * name" used to mean the loser vanished from every read surface its own owner
 * had. They could not list it, delete it, or reach its revision history, which
 * made the point-in-time restore unreachable for any save another account
 * currently wins. So the loser comes back out of here too, and the endpoints
 * key their own-row lookups on `(gameId, userId, filename)`.
 *
 * THE RULE: the newest `clientModifiedAt` wins — the most recently played
 * session is the one whose progress everyone should see.
 */
export function collapseByFilename<T extends CollapsibleSave>(
  rows: T[],
  userId: string,
): CollapsedSave<T>[] {
  const byFilename = new Map<string, T[]>();
  for (const row of rows) {
    const held = byFilename.get(row.filename);
    if (held) held.push(row);
    else byFilename.set(row.filename, [row]);
  }

  const out: CollapsedSave<T>[] = [];
  for (const group of byFilename.values()) {
    let winner = group[0];
    for (const row of group.slice(1)) {
      if (beats(row, winner, userId)) winner = row;
    }
    const own = group.find((row) => row.userId === userId) ?? null;
    out.push({
      winner,
      shadowedOwn: own && own.id !== winner.id ? own : null,
      alsoHeldBy: [
        ...new Set(
          group
            .filter(
              (row) => row.userId !== winner.userId && row.userId !== userId,
            )
            .map((row) => row.user.displayName),
        ),
      ],
    });
  }
  return out;
}

/**
 * Strict total order over rows sharing a filename, so two endpoints answering
 * the same question can never disagree.
 *
 * `clientModifiedAt` is the file's mtime as the uploading machine reported it,
 * and the upload endpoints accept anything up to five minutes in the future.
 * A machine whose clock runs fast would therefore beat an honest one forever
 * under a raw "newest wins", and the honest owner's newer progress would just
 * stop appearing. So near-ties fall through to `uploadedAt`, which the server
 * stamps itself.
 *
 * "Near" is a fixed bucket rather than a sliding window on purpose. A window
 * is not transitive — a beats b, b beats c, c beats a is reachable with three
 * rows six minutes apart — and a non-transitive comparison makes the winner
 * depend on row order, which is exactly the ambiguity this is meant to remove.
 * Flooring both timestamps into the same-sized bucket keeps it a total order.
 */
function beats<T extends CollapsibleSave>(
  candidate: T,
  held: T,
  userId: string,
): boolean {
  const a = Math.floor(
    candidate.clientModifiedAt.getTime() / CLOCK_SKEW_BUCKET_MS,
  );
  const b = Math.floor(held.clientModifiedAt.getTime() / CLOCK_SKEW_BUCKET_MS);
  if (a !== b) return a > b;
  const uploadedA = candidate.uploadedAt.getTime();
  const uploadedB = held.uploadedAt.getTime();
  if (uploadedA !== uploadedB) return uploadedA > uploadedB;
  const candidateIsOwn = candidate.userId === userId;
  const heldIsOwn = held.userId === userId;
  if (candidateIsOwn !== heldIsOwn) return candidateIsOwn;
  return candidate.id > held.id;
}
