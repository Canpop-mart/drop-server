/**
 * Time windows for the "Wrapped" stat screens. Windowed sums must come from
 * PlaySession / UserAchievement (the Playtime aggregate is a lifetime total
 * with no per-window breakdown), so every wrapped query filters on a `since`
 * lower bound derived here. Windows are rolling (now minus N days), not
 * calendar-aligned — the simplest thing that reads sensibly at any time.
 */
export type WrappedWindow = "all" | "year" | "month" | "week";

export function normalizeWindow(raw: unknown): WrappedWindow {
  return raw === "year" || raw === "month" || raw === "week" ? raw : "all";
}

/** Lower bound for a window, or `undefined` for all-time (no filter). */
export function windowSince(window: WrappedWindow): Date | undefined {
  const DAY = 86_400_000;
  const now = Date.now();
  switch (window) {
    case "week":
      return new Date(now - 7 * DAY);
    case "month":
      return new Date(now - 30 * DAY);
    case "year":
      return new Date(now - 365 * DAY);
    default:
      return undefined;
  }
}
