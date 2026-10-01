/**
 * Limits and checks for the user profile routes (server/api/v1/user/*).
 *
 * Pure functions so they can be reasoned about apart from the routes. They are
 * untested: drop-server has no test runner.
 */
import { normalizeProfileTheme } from "~/server/internal/utils/profile-themes";

/** Must match the clients' showcase-merge.ts MAX_SHOWCASE_ITEMS. */
export const MAX_SHOWCASE_ITEMS = 12;
export const MAX_FAVORITES = 10;
/** The editors' input maxlength values. */
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_BIO_LENGTH = 500;
/** Custom cards cap their text at 120; achievement titles come from providers. */
export const MAX_SHOWCASE_TITLE_LENGTH = 200;
/** Big Picture stores an achievement's icon URL and description here. */
export const MAX_SHOWCASE_DATA_BYTES = 4096;

export type ProfilePatch = {
  displayName?: string | undefined;
  bio?: string | undefined;
  profileTheme?: string | undefined;
};

/** The stored values a profile PATCH is compared against. */
export type StoredProfile = {
  displayName: string;
  bio: string;
  profileTheme: string;
};

/**
 * Validate a profile PATCH body. Returns the fields to write, or the reason
 * the body is refused. An empty bio is allowed (that is how it is cleared);
 * an empty display name is not.
 *
 * Every editor sends all three fields on every save, so a field equal to its
 * stored value is left out and not checked. Values stored before these limits
 * existed (signup kept an empty display name, OIDC copies whatever name the
 * provider has) would otherwise make every save fail, even one that only
 * changes the theme.
 */
export function validateProfilePatch(
  body: ProfilePatch,
  stored: StoredProfile,
): { data: Record<string, string> } | { error: string } {
  const data: Record<string, string> = {};

  if (
    body.displayName !== undefined &&
    body.displayName !== stored.displayName
  ) {
    const name = body.displayName.trim();
    const problem = displayNameProblem(name);
    if (problem) return { error: problem };
    if (name !== stored.displayName) data.displayName = name;
  }

  if (body.bio !== undefined && body.bio !== stored.bio) {
    if (body.bio.length > MAX_BIO_LENGTH)
      return { error: `Bio can be at most ${MAX_BIO_LENGTH} characters.` };
    data.bio = body.bio;
  }

  if (
    body.profileTheme !== undefined &&
    body.profileTheme !== stored.profileTheme
  ) {
    const theme = normalizeProfileTheme(body.profileTheme);
    if (!theme)
      return {
        error: "Profile theme must be a preset name or a #rrggbb colour.",
      };
    if (theme !== stored.profileTheme) data.profileTheme = theme;
  }

  return { data };
}

/** Why a (trimmed) display name is refused, or null if it is fine. */
export function displayNameProblem(name: string): string | null {
  if (name.length === 0) return "Display name can't be empty.";
  if (name.length > MAX_DISPLAY_NAME_LENGTH)
    return `Display name can be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`;
  return null;
}

/**
 * The display name a new account starts with: the requested one trimmed and
 * cut to the limit, or `fallback` (the username) when that leaves nothing.
 * Used by signup and OIDC so new accounts start inside the PATCH limits.
 */
export function initialDisplayName(
  requested: string | null | undefined,
  fallback: string,
): string {
  // OIDC claims are not validated, so don't trust the type.
  const raw = typeof requested === "string" ? requested : "";
  const name = raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  if (name.length > 0) return name;
  return fallback.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || fallback;
}

export type ShowcaseItemInput = {
  type: string;
  gameId?: string | null | undefined;
  itemId?: string | null | undefined;
  title?: string | undefined;
  data?: unknown;
};

/** Why one showcase item is too large, or null if it fits. */
export function showcaseItemSizeProblem(
  item: ShowcaseItemInput,
): string | null {
  if ((item.title ?? "").length > MAX_SHOWCASE_TITLE_LENGTH)
    return `Showcase titles can be at most ${MAX_SHOWCASE_TITLE_LENGTH} characters.`;
  if (item.data !== undefined && item.data !== null) {
    const json = JSON.stringify(item.data);
    if (Buffer.byteLength(json ?? "", "utf8") > MAX_SHOWCASE_DATA_BYTES)
      return "A showcase item carries too much data.";
  }
  return null;
}

/**
 * JSON with object keys sorted, so two equal values compare equal however
 * their keys were ordered (Postgres jsonb reorders keys, and the editors
 * rebuild `data` objects themselves).
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort())
        sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

function showcaseItemIdentity(item: {
  type: string;
  gameId?: string | null;
  itemId?: string | null;
  title?: string | null;
  data?: unknown;
}): string {
  return JSON.stringify([
    item.type,
    item.gameId ?? null,
    item.itemId ?? null,
    item.title ?? "",
    canonicalJson(item.data),
  ]);
}

/**
 * The first size problem among the items in `items` that are not stored
 * exactly as sent, or null. Every save sends the whole list back, so an item
 * stored before the size limits existed would otherwise block all later
 * edits; it is only refused once it is changed.
 */
export function showcaseSizeProblem(
  items: readonly ShowcaseItemInput[],
  stored: readonly {
    type: string;
    gameId: string | null;
    itemId: string | null;
    title: string;
    data: unknown;
  }[],
): string | null {
  const storedKeys = new Set(stored.map(showcaseItemIdentity));
  for (const item of items) {
    if (storedKeys.has(showcaseItemIdentity(item))) continue;
    const problem = showcaseItemSizeProblem(item);
    if (problem) return problem;
  }
  return null;
}

function achievementKey(gameId?: string | null, itemId?: string | null) {
  return `${gameId ?? ""}\u0000${itemId ?? ""}`;
}

/**
 * The Achievement items in `items` that are not already stored for the user.
 * Only these are checked for ownership: an item that is already stored was
 * accepted before this check existed (the pickers used to offer locked
 * achievements), and every save sends the whole list back, so refusing it
 * would block all later edits.
 */
export function newAchievementItems<T extends ShowcaseItemInput>(
  items: readonly T[],
  stored: readonly { gameId: string | null; itemId: string | null }[],
): T[] {
  const storedKeys = new Set(
    stored.map((s) => achievementKey(s.gameId, s.itemId)),
  );
  return items.filter(
    (i) =>
      i.type === "Achievement" &&
      !storedKeys.has(achievementKey(i.gameId, i.itemId)),
  );
}

/** Key for "this user unlocked some provider's variant of this achievement". */
export function achievementVariantKey(gameId: string, externalId: string) {
  return `${gameId}\u0000${externalId}`;
}
