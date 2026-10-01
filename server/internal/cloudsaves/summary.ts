import { collapseByFilename, isReadableSave } from "./scope";

/**
 * Rolling up cloud saves into one line per game.
 *
 * The per-game listing (`saves/list.get.ts`) answers "what is in this game's
 * cloud folder". Nothing answered "are my saves backed up" across a library,
 * which is the question a user actually asks, so this is the shape behind the
 * library-wide endpoint.
 *
 * Every rule the per-game listing follows has to hold here too, or the two
 * surfaces disagree about the same bytes: the same read scope, the same
 * filename collapse, the same newest-wins winner. That is why this takes rows
 * that have already been through `readableSaveScope` and runs them through the
 * shared `isReadableSave` / `collapseByFilename` rather than counting the raw
 * `findMany` result. With per-user reads the collapse is one row per filename
 * and the shared/own split below is all-own; the fields stay for older
 * clients.
 */

/** The row shape this module needs. Widen the `select` in the endpoint, not this. */
export interface SummarisableSave {
  id: string;
  userId: string;
  user: { displayName: string };
  gameId: string;
  game: { mName: string };
  filename: string;
  saveType: string;
  size: number;
  clientModifiedAt: Date;
  uploadedAt: Date;
}

/** One game's worth of cloud saves, as the client renders it. */
export interface GameSaveSummary {
  gameId: string;
  gameName: string;
  /** Files after the collision collapse, i.e. what a listing would show. */
  fileCount: number;
  /** Sum of the shown files' sizes. */
  totalBytes: number;
  /** Newest server-stamped upload time across the shown files, ISO 8601. */
  lastUploadedAt: string;
  /** Newest client mtime across the shown files, ISO 8601. */
  lastModifiedAt: string;
  /**
   * How many of the shown files are another account's copy. Always 0 now that
   * reads are per user; kept for older clients.
   */
  sharedCount: number;
  /**
   * How many files of this game the caller has backed up themselves. Equal
   * to `fileCount` now that reads are per user; kept because older clients
   * count this rather than `fileCount`.
   */
  ownCount: number;
  /** Sum of the caller's own files' sizes, on the same rule as `ownCount`. */
  ownBytes: number;
}

/**
 * Group readable saves into one summary per game, newest upload first.
 *
 * `rows` must already be scoped with `readableSaveScope(userId)` and filtered
 * to `deletedAt: null`; the filename-namespace gate that Prisma cannot express
 * is applied here.
 */
export function summariseByGame(
  rows: SummarisableSave[],
  userId: string,
): GameSaveSummary[] {
  const byGame = new Map<string, SummarisableSave[]>();
  for (const row of rows) {
    if (!isReadableSave(row, userId)) continue;
    const held = byGame.get(row.gameId);
    if (held) held.push(row);
    else byGame.set(row.gameId, [row]);
  }

  const out: GameSaveSummary[] = [];
  for (const [gameId, group] of byGame) {
    const collapsed = collapseByFilename(group, userId);
    if (collapsed.length === 0) continue;

    let totalBytes = 0;
    let lastUploaded = 0;
    let lastModified = 0;
    let sharedCount = 0;
    let ownCount = 0;
    let ownBytes = 0;
    for (const { winner, shadowedOwn } of collapsed) {
      totalBytes += winner.size;
      lastUploaded = Math.max(lastUploaded, winner.uploadedAt.getTime());
      lastModified = Math.max(lastModified, winner.clientModifiedAt.getTime());
      if (winner.userId !== userId) sharedCount++;
      // The caller's own row for this filename (always the winner while
      // reads are per user).
      const own = winner.userId === userId ? winner : shadowedOwn;
      if (own) {
        ownCount++;
        ownBytes += own.size;
      }
    }

    out.push({
      gameId,
      gameName: group[0].game.mName,
      fileCount: collapsed.length,
      totalBytes,
      lastUploadedAt: new Date(lastUploaded).toISOString(),
      lastModifiedAt: new Date(lastModified).toISOString(),
      sharedCount,
      ownCount,
      ownBytes,
    });
  }

  return out.sort(
    (a, b) =>
      new Date(b.lastUploadedAt).getTime() -
      new Date(a.lastUploadedAt).getTime(),
  );
}
