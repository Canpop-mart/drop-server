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

  let totalSynced = 0;

  for (const account of externalAccounts) {
    if (account.provider === ExternalAccountProvider.RetroAchievements) {
      totalSynced += await syncRetroAchievements(userId, account.externalId);
    }
    // Steam and other providers can be added here
  }

  return { synced: totalSynced };
});

async function syncRetroAchievements(userId: string, raUsername: string): Promise<number> {
  try {
    // Fetch all games that have RA external links
    const gameLinks = await prisma.gameExternalLink.findMany({
      where: { provider: ExternalAccountProvider.RetroAchievements },
    });

    if (gameLinks.length === 0) return 0;

    let synced = 0;

    for (const link of gameLinks) {
      // Fetch user's unlocks from RA API
      const raGameId = link.externalGameId;
      const response = await fetch(
        `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?z=${raUsername}&y=${process.env.RA_API_KEY}&g=${raGameId}&u=${raUsername}`
      );

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.Achievements) continue;

      for (const [achId, achData] of Object.entries(data.Achievements) as [string, Record<string, unknown>][]) {
        if (achData.DateEarned) {
          // Find matching achievement in our DB
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
