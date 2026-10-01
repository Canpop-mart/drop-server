/**
 * Why a game shows no achievements, or why its achievements can't track for
 * this player.
 *
 * An empty achievement list used to look the same whether the game has no
 * achievements, the server is missing STEAM_API_KEY, nobody linked the game,
 * or the player never connected RetroAchievements. This derives an honest
 * reason from what the server actually knows so every surface can say which.
 */
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { resolveRACredentialsForPlayer } from "~/server/internal/retroachievements";

/**
 * Reason a game has no achievement definitions. Null when it has some.
 *
 * - `no_link`: the game is not linked to Steam (Goldberg) or
 *   RetroAchievements and was not imported from Steam metadata, so the
 *   server has nowhere to get achievements from.
 * - `steam_key_missing`: the game is Steam-backed but the server has no
 *   STEAM_API_KEY, and there was no achievement file in the game files.
 * - `ra_credentials_missing`: the game is linked to RetroAchievements but
 *   there are neither server RA credentials (RA_USERNAME / RA_API_KEY) nor a
 *   Web API key of this player's own to read it with.
 * - `not_scanned`: linked, and the server could fetch, but no definitions are
 *   stored. Either nobody has run the achievement scan for it yet, or the
 *   source lists none for this game.
 */
export type AchievementUnavailableReason =
  | "no_link"
  | "steam_key_missing"
  | "ra_credentials_missing"
  | "not_scanned";

/** Plain-English explanation for logs and the diagnostics panel. */
export function describeUnavailableReason(
  reason: AchievementUnavailableReason,
): string {
  switch (reason) {
    case "no_link":
      return "This game is not linked to Steam or RetroAchievements.";
    case "steam_key_missing":
      return "The server has no STEAM_API_KEY, so it cannot fetch this game's achievements.";
    case "ra_credentials_missing":
      return "The server has no RetroAchievements credentials to fetch this game's achievements with.";
    case "not_scanned":
      return "No achievements are stored for this game. It may not have been scanned yet, or it has none.";
  }
}

export interface AvailabilityFacts {
  definitionCount: number;
  /** A Goldberg link exists, or the game's metadata came from Steam. */
  steamBacked: boolean;
  raLinked: boolean;
  steamApiKeySet: boolean;
  raCredentialsAvailable: boolean;
}

/**
 * Pure mapping from facts to a reason. drop-server has no test runner, so
 * this is exported and untested.
 */
export function deriveUnavailableReason(
  f: AvailabilityFacts,
): AchievementUnavailableReason | null {
  if (f.definitionCount > 0) return null;
  if (!f.steamBacked && !f.raLinked) return "no_link";
  // An RA link wins: the client tracks RA-linked games through RA.
  if (f.raLinked) {
    return f.raCredentialsAvailable ? "not_scanned" : "ra_credentials_missing";
  }
  return f.steamApiKeySet ? "not_scanned" : "steam_key_missing";
}

export interface AchievementAvailability {
  definitionCount: number;
  reason: AchievementUnavailableReason | null;
  /**
   * The game tracks through RetroAchievements and this player has not linked
   * an RA account, so nothing they earn will be recorded.
   */
  raAccountMissing: boolean;
}

export async function getAchievementAvailability(
  gameId: string,
  userId: string,
): Promise<AchievementAvailability> {
  const [game, links, definitionCount, raAccount] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      select: { metadataSource: true },
    }),
    prisma.gameExternalLink.findMany({
      where: { gameId },
      select: { provider: true },
    }),
    prisma.achievement.count({ where: { gameId } }),
    prisma.userExternalAccount.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
      select: { externalId: true },
    }),
  ]);

  const raLinked = links.some(
    (l) => l.provider === ExternalAccountProvider.RetroAchievements,
  );
  const steamBacked =
    links.some((l) => l.provider === ExternalAccountProvider.Goldberg) ||
    game?.metadataSource === "Steam";

  // Only worth the lookup when the answer can change the reason. Same rule
  // as syncing this player: the server's own RA credentials or the player's
  // own key, never another player's.
  const raCredentialsAvailable =
    raLinked && definitionCount === 0
      ? (await resolveRACredentialsForPlayer(userId)) !== null
      : true;

  const reason = deriveUnavailableReason({
    definitionCount,
    steamBacked,
    raLinked,
    steamApiKeySet: !!process.env.STEAM_API_KEY,
    raCredentialsAvailable,
  });

  return {
    definitionCount,
    reason,
    raAccountMissing: raLinked && !raAccount?.externalId,
  };
}
