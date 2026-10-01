/**
 * Who may READ whose cloud saves: the account that uploaded them, and nobody
 * else.
 *
 * PC saves (`saveType` "pc") used to be readable by every account on the
 * server, on the grounds that two accounts playing one PC game on one machine
 * read and write the same files on disk. That made a housemate's progress
 * land in your library and turned every PC save into a newest-wins race
 * between accounts. Saves are now strictly per user, every type alike.
 *
 * The cost, accepted on purpose: two Drop accounts on the same PC still share
 * one set of PC save files on disk, because the game decides where those
 * live. Switching accounts there can therefore raise a conflict prompt (this
 * account's cloud copy against the file the other account's session wrote),
 * and the prompt says whose copy is whose.
 *
 * No migration was needed. Rows another account uploaded simply stop being
 * visible to you; nothing is moved or deleted.
 *
 * Writes were already keyed on `(gameId, userId, filename)` and are unchanged.
 */

/**
 * Prisma `where` fragment for "rows this user may read". Compose it with
 * `gameId` / `deletedAt` / `id` as needed.
 */
export function readableSaveScope(userId: string) {
  return { userId };
}

/** Row-level form of {@link readableSaveScope}, for single-row lookups. */
export function isReadableSave(
  save: { userId: string },
  userId: string,
): boolean {
  return save.userId === userId;
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
 * With reads scoped to the caller's own rows and `(gameId, userId, filename)`
 * unique, every group here holds exactly one row: the winner is that row,
 * `shadowedOwn` is null and `alsoHeldBy` is empty. It is kept, rather than
 * deleted, because `list` / `summary` still answer with `shadowedSaveId` and
 * `alsoHeldBy` and older clients read them. Should reads ever widen again,
 * this is the rule they would go through.
 *
 * THE RULE: the newest `clientModifiedAt` wins.
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
