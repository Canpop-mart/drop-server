import type { GameCompatibilityStatus, Platform } from "~/prisma/client/enums";

export type PlatformCompatResult = {
  status: GameCompatibilityStatus;
  signature: string | null;
  protonVersion: string | null;
  testedAt: string;
};

export type GameCompatSummary = Partial<Record<Platform, PlatformCompatResult>>;
export type CompatLibrarySummary = Record<string, GameCompatSummary>;

/**
 * Per-(game, platform) compatibility data for every game in the calling
 * user's library, aggregated across all the user's clients (best status
 * wins per platform, ties broken by most-recent).
 *
 * Backed by `GET /api/v1/client/compat/library-summary` and cached for the
 * lifetime of the page. Call `refreshCompatSummary()` after a test run
 * completes to invalidate.
 *
 * Internally the state ref carries `CompatLibrarySummary | undefined` so
 * we can use `undefined` as a "not yet fetched" sentinel — `useState` won't
 * accept `() => undefined` for a non-nullable type. The post-fetch cast
 * narrows the return type for ergonomic call sites.
 */
export const useCompatSummary = async () => {
  const state = useState<CompatLibrarySummary | undefined>(
    "compat-summary",
    () => undefined,
  );
  if (state.value === undefined) {
    state.value = await $dropFetch<CompatLibrarySummary>(
      "/api/v1/client/compat/library-summary",
    );
  }
  return state as Ref<CompatLibrarySummary>;
};

export async function refreshCompatSummary() {
  const state = useState<CompatLibrarySummary | undefined>("compat-summary");
  state.value = await $dropFetch<CompatLibrarySummary>(
    "/api/v1/client/compat/library-summary",
  );
}
