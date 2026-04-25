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
 */
export const useCompatSummary = async () => {
  // @ts-expect-error undefined sentinel for "not yet fetched"
  const state = useState<CompatLibrarySummary>(
    "compat-summary",
    () => undefined,
  );
  if (state.value === undefined) {
    state.value = await $dropFetch<CompatLibrarySummary>(
      "/api/v1/client/compat/library-summary",
    );
  }
  return state;
};

export async function refreshCompatSummary() {
  const state = useState<CompatLibrarySummary>("compat-summary");
  state.value = await $dropFetch<CompatLibrarySummary>(
    "/api/v1/client/compat/library-summary",
  );
}
