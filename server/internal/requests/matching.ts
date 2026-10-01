/**
 * Pure helpers for game requests: duplicate detection on create, and linking
 * requests to a game when it is imported.
 *
 * Nothing in here touches the database, so it can be read and reasoned about
 * on its own. drop-server has no test runner, so these functions are
 * UNTESTED; keep them pure so a test can be added without mocking Prisma.
 */

export type RequestStatusName = "Pending" | "Approved" | "Denied" | "Withdrawn";

/** The fields of a GameRequest row these helpers read. */
export type RequestRef = {
  id: string;
  title: string;
  status: RequestStatusName;
  gameId: string | null;
  steamUrl: string | null;
  reviewNotes: string | null;
  metadataSource: string | null;
  metadataId: string | null;
  metadataName: string | null;
};

/** A provider id pair, e.g. { source: "Steam", id: "620" }. */
export type MetadataKey = { source: string; id: string };

const MANUAL_SOURCE = "Manual";

/**
 * Title normalisation for duplicate and manual-approval matching. Lowercases,
 * strips accents and trademark symbols, treats "&" as "and", and collapses
 * every run of punctuation or whitespace to one space. "Half-Life 2" and
 * "half life 2" compare equal; "Doom" and "Doom (1993)" do not.
 */
export function normaliseTitle(title: string): string {
  return (
    title
      // Before NFKD, which would turn "™" into the letters "TM".
      .replace(/[\u2122\u00ae\u00a9]/g, "")
      .normalize("NFKD")
      // Combining accents left behind by NFKD.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/**
 * Steam app id from a store URL, or null if the URL is not one. Only a
 * link whose host is store.steampowered.com and whose path starts with
 * /app/<digits> counts, so a link elsewhere that merely contains that text
 * (in its query, or a look-alike host) cannot claim a Steam game. A link
 * typed without a scheme is read as https.
 */
export function steamAppIdFromUrl(url: string | null | undefined) {
  const raw = url?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // URL lowercases the host but keeps a trailing root dot, and
  // "store.steampowered.com." is the same host.
  const host = parsed.hostname.replace(/\.$/, "");
  if (host !== "store.steampowered.com") return null;
  const match = /^\/app\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  return match ? match[1] : null;
}

/**
 * Metadata stored by approvals made before the metadataSource / metadataId
 * columns existed: reviewNotes held `{ "metadata": { sourceId, id, name },
 * ... }`. Returns null for anything else, including a plain-text deny reason.
 */
export function legacyApprovalMetadata(
  reviewNotes: string | null,
): (MetadataKey & { name: string | null }) | null {
  if (!reviewNotes || !reviewNotes.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(reviewNotes) as {
      metadata?: { sourceId?: unknown; id?: unknown; name?: unknown };
    };
    const m = parsed?.metadata;
    if (!m || typeof m.sourceId !== "string" || typeof m.id !== "string")
      return null;
    return {
      source: m.sourceId,
      id: m.id,
      name: typeof m.name === "string" ? m.name : null,
    };
  } catch {
    // Not JSON: a deny reason that happens to start with "{". Not metadata.
    return null;
  }
}

/**
 * Text that is safe to show the requester as the review note. Legacy approval
 * JSON is internal bookkeeping, so it is hidden.
 */
export function requesterVisibleNote(reviewNotes: string | null) {
  if (!reviewNotes) return null;
  const trimmed = reviewNotes.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return null;
    } catch {
      return reviewNotes;
    }
  }
  return reviewNotes;
}

/**
 * Every provider id a request can be matched on, plus the title an admin
 * approved it under when there was no provider match.
 */
export function requestMetadataRefs(req: RequestRef): {
  keys: MetadataKey[];
  manualTitle: string | null;
} {
  const keys: MetadataKey[] = [];
  let manualTitle: string | null = null;

  if (req.metadataSource && req.metadataId) {
    keys.push({ source: req.metadataSource, id: req.metadataId });
  } else if (req.metadataSource === MANUAL_SOURCE) {
    manualTitle = req.metadataName || req.title;
  } else {
    const legacy = legacyApprovalMetadata(req.reviewNotes);
    if (legacy) keys.push({ source: legacy.source, id: legacy.id });
  }

  const steamId = steamAppIdFromUrl(req.steamUrl);
  if (steamId) keys.push({ source: "Steam", id: steamId });

  return { keys, manualTitle };
}

function sameKey(a: MetadataKey, b: MetadataKey) {
  return a.source === b.source && a.id === b.id;
}

export type ImportedGameRef = {
  /**
   * Provider ids the game is known by: the provider that actually supplied
   * the metadata, and the one the admin picked if the import fell back to a
   * different provider.
   */
  keys: MetadataKey[];
  name: string;
};

/**
 * Which open requests an imported game satisfies.
 *
 * - Pending and Approved requests with no game yet are eligible. Denied and
 *   Withdrawn requests are never touched.
 * - A provider id match links the request whatever its status.
 * - A title match is only used for requests that hold an admin's manual
 *   title (approved with no provider match available), and only on the
 *   exact normalised title. Requesters cannot pick Manual (create.post.ts
 *   refuses it), so a manual title is always the admin's. That includes a
 *   Pending one: an approval moved back to Pending (its import failed, or
 *   the admin reopened it) keeps the admin's pick, and an import that
 *   finishes anyway still links it. A requester's own title never links.
 */
export function matchRequestsForImportedGame(
  game: ImportedGameRef,
  requests: RequestRef[],
): string[] {
  const gameKeys = game.keys.filter((k) => k.id !== "");
  const gameTitle = normaliseTitle(game.name);
  const matched: string[] = [];
  for (const req of requests) {
    if (req.gameId) continue;
    if (req.status !== "Pending" && req.status !== "Approved") continue;
    const { keys, manualTitle } = requestMetadataRefs(req);
    const idMatch = keys.some((k) => gameKeys.some((g) => sameKey(k, g)));
    const titleMatch =
      manualTitle !== null &&
      gameTitle !== "" &&
      normaliseTitle(manualTitle) === gameTitle;
    if (idMatch || titleMatch) matched.push(req.id);
  }
  return matched;
}

export type DuplicateMatch = {
  request: RequestRef;
  /**
   * "metadata": same provider id, a certain duplicate.
   * "title": same normalised title, probably a duplicate; the requester may
   * submit anyway.
   */
  reason: "metadata" | "title";
};

/**
 * Finds an open request (Pending or Approved) that a new request would
 * duplicate. Provider id matches win over title matches.
 */
export function findDuplicateRequest(
  candidate: {
    title: string;
    metadata: MetadataKey | null;
    steamUrl: string | null;
  },
  existing: RequestRef[],
): DuplicateMatch | null {
  const open = existing.filter(
    (r) => r.status === "Pending" || r.status === "Approved",
  );

  const candidateKeys: MetadataKey[] = [];
  if (candidate.metadata && candidate.metadata.id)
    candidateKeys.push(candidate.metadata);
  const steamId = steamAppIdFromUrl(candidate.steamUrl);
  if (steamId) candidateKeys.push({ source: "Steam", id: steamId });

  if (candidateKeys.length > 0) {
    for (const req of open) {
      const { keys } = requestMetadataRefs(req);
      if (keys.some((k) => candidateKeys.some((c) => sameKey(k, c))))
        return { request: req, reason: "metadata" };
    }
  }

  const title = normaliseTitle(candidate.title);
  if (title === "") return null;
  for (const req of open) {
    // Both sides name a provider id and the ids differ (checked above), so
    // these are different games that share a name, e.g. two releases of
    // "Doom". Not a duplicate.
    if (candidateKeys.length > 0 && requestMetadataRefs(req).keys.length > 0)
      continue;
    if (
      normaliseTitle(req.title) === title ||
      (req.metadataName !== null && normaliseTitle(req.metadataName) === title)
    )
      return { request: req, reason: "title" };
  }
  return null;
}
