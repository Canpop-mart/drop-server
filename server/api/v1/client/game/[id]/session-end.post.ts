import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

/**
 * Called by the game client when a play session ends.
 * Triggers an automatic achievement sync for the user + game
 * to catch any achievements the client may not have reported directly.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Get user's linked external accounts
  const externalAccounts = await prisma.userExternalAccount.findMany({
    where: { userId: user.id },
  });

  if (externalAccounts.length === 0) {
    return { synced: 0 };
  }

  // Get external links for this specific game
  const gameLinks = await prisma.gameExternalLink.findMany({
    where: { gameId },
  });

  if (gameLinks.length === 0) {
    return { synced: 0 };
  }

  let totalSynced = 0;

  for (const account of externalAccounts) {
    // Only sync providers that have a link for this game
    const matchingLink = gameLinks.find((l) => l.provider === account.provider);
    if (!matchingLink) continue;

    if (account.provider === ExternalAccountProvider.Steam) {
      totalSynced += await syncSteamForGame(
        user.id,
        account.externalId,
        gameId,
        matchingLink.externalGameId,
      );
    } else if (account.provider === ExternalAccountProvider.RetroAchievements) {
      totalSynced += await syncRAForGame(
        user.id,
        account.externalId,
        gameId,
        matchingLink.externalGameId,
      );
    }
    // Goldberg achievements are synced client-side via achievements-report
    // endpoint, not here — the server cannot read client %APPDATA%.
  }

  return { synced: totalSynced };
});

async function syncSteamForGame(
  userId: string,
  steamId: string,
  gameId: string,
  steamAppId: string,
): Promise<number> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return 0;

  try {
    const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${steamAppId}&key=${apiKey}&steamid=${steamId}&format=json`;
    const response = await fetch(url);
    if (!response.ok) return 0;

    const data = await response.json();
    if (!data.playerstats?.success || !data.playerstats?.achievements?.length)
      return 0;

    let synced = 0;
    for (const steamAch of data.playerstats.achievements) {
      if (steamAch.achieved !== 1) continue;

      const achievement = await prisma.achievement.findUnique({
        where: {
          gameId_provider_externalId: {
            gameId,
            provider: ExternalAccountProvider.Steam,
            externalId: String(steamAch.apiname),
          },
        },
      });
      if (!achievement) continue;

      await prisma.userAchievement.upsert({
        where: {
          userId_achievementId: { userId, achievementId: achievement.id },
        },
        create: {
          userId,
          achievementId: achievement.id,
          unlockedAt: steamAch.unlocktime
            ? new Date(steamAch.unlocktime * 1000)
            : new Date(),
        },
        update: {},
      });
      synced++;
    }
    return synced;
  } catch {
    return 0;
  }
}

async function syncRAForGame(
  userId: string,
  raUsername: string,
  gameId: string,
  raGameId: string,
): Promise<number> {
  const apiKey = process.env.RA_API_KEY;
  if (!apiKey) return 0;

  try {
    const response = await fetch(
      `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?z=${raUsername}&y=${apiKey}&g=${raGameId}&u=${raUsername}`,
    );
    if (!response.ok) return 0;

    const data = await response.json();
    if (!data.Achievements) return 0;

    let synced = 0;
    for (const [achId, achData] of Object.entries(data.Achievements) as [
      string,
      Record<string, unknown>,
    ][]) {
      if (!achData.DateEarned) continue;

      const achievement = await prisma.achievement.findUnique({
        where: {
          gameId_provider_externalId: {
            gameId,
            provider: ExternalAccountProvider.RetroAchievements,
            externalId: String(achId),
          },
        },
      });
      if (!achievement) continue;

      await prisma.userAchievement.upsert({
        where: {
          userId_achievementId: { userId, achievementId: achievement.id },
        },
        create: {
          userId,
          achievementId: achievement.id,
          unlockedAt: new Date(String(achData.DateEarned)),
        },
        update: {},
      });
      synced++;
    }
    return synced;
  } catch {
    return 0;
  }
}
