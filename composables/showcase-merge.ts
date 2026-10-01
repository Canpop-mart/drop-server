/**
 * The profile editors (the web account page here, and Big Picture in the
 * client) only show the first few FavoriteGame and Achievement showcase items
 * as slots, while the server stores up to 12 items of four types and PUT
 * replaces the whole list. Saving just the slots deleted every item the page
 * doesn't display (GameStats and Custom cards made in the desktop client, and
 * anything past the slot limit). These helpers put the slot edits back into
 * the full list instead.
 *
 * The functions below are a copy of drop-app's
 * main/composables/bigpicture/showcase-merge.ts, which is where they are
 * tested (main/tests/showcase-merge.test.ts); drop-server has no test runner.
 * Keep the two in step.
 */

/** Must match MAX_SHOWCASE_ITEMS in drop-server's user/showcase.put.ts. */
export const MAX_SHOWCASE_ITEMS = 12;

export interface ShowcaseEntry {
  type: string;
  gameId?: string | null;
  itemId?: string | null;
  title?: string;
  data?: unknown;
}

/**
 * Which loaded items the slots edit: the first `maxGames` FavoriteGame items
 * and the first `maxAchievements` Achievement items, in stored order.
 */
export function slotItems<T extends ShowcaseEntry>(
  loaded: T[],
  maxGames: number,
  maxAchievements: number,
): { games: T[]; achievements: T[] } {
  return {
    games: loaded.filter((i) => i.type === "FavoriteGame").slice(0, maxGames),
    achievements: loaded
      .filter((i) => i.type === "Achievement")
      .slice(0, maxAchievements),
  };
}

/** How many loaded items the slots do not show, and must be kept as they are. */
export function untouchedCount(
  loaded: ShowcaseEntry[],
  maxGames: number,
  maxAchievements: number,
): number {
  const { games, achievements } = slotItems(loaded, maxGames, maxAchievements);
  return loaded.length - games.length - achievements.length;
}

/**
 * The full list to PUT: every item the slots don't show stays where it was,
 * the slot contents fill the positions the slot items used to hold (in slot
 * order), and anything added beyond that is appended, games first.
 */
export function mergeShowcase<T extends ShowcaseEntry>(
  loaded: T[],
  games: T[],
  achievements: T[],
  maxGames: number,
  maxAchievements: number,
): T[] {
  const gameQueue = [...games];
  const achQueue = [...achievements];
  let gamesSeen = 0;
  let achsSeen = 0;
  const out: T[] = [];

  for (const item of loaded) {
    if (item.type === "FavoriteGame" && gamesSeen < maxGames) {
      gamesSeen++;
      const next = gameQueue.shift();
      if (next) out.push(next);
    } else if (item.type === "Achievement" && achsSeen < maxAchievements) {
      achsSeen++;
      const next = achQueue.shift();
      if (next) out.push(next);
    } else {
      out.push(item);
    }
  }
  out.push(...gameQueue, ...achQueue);
  return out;
}
