import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Get user's linked external accounts
  const externalAccounts = await prisma.userExternalAccount.findMany({
    where: { userId },
  });

  if (externalAccounts.length === 0) {
    return { synced: 0, message: "No external accounts linked." };
  }

  // Optional: filter to a specific game
  const query = getQuery(h3);
  const gameId = query.gameId as string | undefined;

  let totalSynced = 0;

  for (const account of externalAccounts) {
    if (account.provider === ExternalAccountProvider.RetroAchievements) {
      totalSynced += await syncRetroAchievements(
        userId,
        account.externalId,
        gameId,
      );
    } else if (account.provider === ExternalAccountProvider.Steam) {
      totalSynced += await syncSteamAchievements(
        userId,
        account.externalId,
        gameId,
      );
    }
  }

  return { synced: totalSynced };
});

async function syncSteamAchievements(
  userId: string,
  steamId: string,
  filterGameId?: string,
): Promise<number> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return 0;

  try {
    // Fetch all games that have Steam external links
    const linkWhere: { provider: ExternalAccountProvider; gameId?: string } = {
      provider: ExternalAccountProvider.Steam,
    };
    if (filterGameId) linkWhere.gameId = filterGameId;

    const gameLinks = await prisma.gameExternalLink.findMany({
      where: linkWhere,
    });

    if (gameLinks.length === 0) return 0;

    let synced = 0;

    for (const link of gameLinks) {
      try {
        // Get user's achievements for this game from Steam
        const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${link.externalGameId}&key=${apiKey}&steamid=${steamId}&format=json`;
        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();
        if (
          !data.playerstats?.success ||
          !data.playerstats?.achievements?.length
        )
          continue;

        for (const steamAch of data.playerstats.achievements) {
          // Only process unlocked achievements
          if (steamAch.achieved !== 1) continue;

          // Find matching achievement in our DB
          const achievement = await prisma.achievement.findUnique({
            where: {
              gameId_provider_externalId: {
                gameId: link.gameId,
                provider: ExternalAccountProvider.Steam,
                externalId: String(steamAch.apiname),
              },
            },
          });

          if (!achievement) continue;

          await prisma.userAchievement.upsert({
            where: {
              userId_achievementId: {
                userId,
                achievementId: achievement.id,
              },
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
      } catch {
        // Skip individual game sync errors
        continue;
      }
    }

    return synced;
  } catch (e) {
    console.error("Steam sync error:", e);
    return 0;
  }
}

async function syncRetroAchievements(
  userId: string,
  raUsername: string,
  filterGameId?: string,
): Promise<number> {
  try {
    const linkWhere: { provider: ExternalAccountProvider; gameId?: string } = {
      provider: ExternalAccountProvider.RetroAchievements,
    };
    if (filterGameId) linkWhere.gameId = filterGameId;

    const gameLinks = await prisma.gameExternalLink.findMany({
      where: linkWhere,
    });

    if (gameLinks.length === 0) return 0;

    let synced = 0;

    for (const link of gameLinks) {
      const raGameId = link.externalGameId;
      const response = await fetch(
        `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?z=${raUsername}&y=${process.env.RA_API_KEY}&g=${raGameId}&u=${raUsername}`,
      );

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.Achievements) continue;

      for (const [achId, achData] of Object.entries(data.Achievements) as [
        string,
        Record<string, unknown>,
      ][]) {
        if (achData.DateEarned) {
          const achievement = await prisma.achievement.findUnique({
            where: {
              gameId_provider_externalId: {
                gameId: link.gameId,
                provider: ExternalAccountProvider.RetroAchievements,
                externalId: String(achId),
              },
            },
          });

          if (achievement) {
            await prisma.userAchievement.upsert({
              where: {
                userId_achievementId: {
                  userId,
                  achievementId: achievement.id,
                },
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
        }
      }
    }

    return synced;
  } catch (e) {
    console.error("RA sync error:", e);
    return 0;
  }
}
