/**
 * One writer per game version at a time.
 *
 * Everything that rewrites a version's manifest, file list or revision
 * snapshot runs inside `withVersionLock`: manifest regeneration, "Check for
 * changes", "Publish update", "Record fingerprints" and saving a changed
 * mirrored-folder list (which uses tryWithVersionLock). Callers queue in
 * arrival order; a failure in one does not release the next early or block
 * it.
 *
 * In-process only. drop-server runs as a single Node process.
 */

const tails = new Map<string, Promise<void>>();

export async function withVersionLock<T>(
  versionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(versionId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  // `previous` only ever resolves (each link is a `mine` promise), so the
  // chain cannot reject.
  const tail = previous.then(() => mine);
  tails.set(versionId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(versionId) === tail) tails.delete(versionId);
  }
}

/** True while some caller holds or waits for this version's lock. */
export function isVersionLocked(versionId: string): boolean {
  return tails.has(versionId);
}

/**
 * Like withVersionLock, but never waits: when anything holds or waits for
 * this version's lock, returns `{ acquired: false }` without running `fn`.
 *
 * The check and the claim happen before this function's first `await`, so
 * no other caller can get in between them.
 */
export async function tryWithVersionLock<T>(
  versionId: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (tails.has(versionId)) return { acquired: false };
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Later callers queue behind `mine`, exactly as behind withVersionLock.
  tails.set(versionId, mine);
  try {
    return { acquired: true, value: await fn() };
  } finally {
    release();
    if (tails.get(versionId) === mine) tails.delete(versionId);
  }
}
