import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

/**
 * Scans all games that have emulator launch configs (ROM games)
 * For each game, searches RA API by game name
 * If a confident match is found, creates the GameExternalLink + Achievement records
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const raCreds = await resolveRACredentials(userId);
  if (!raCreds) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "RetroAchievements not configured. Set RA_USERNAME/RA_API_KEY or link your RA account in Settings.",
    });
  }

  const raClient = createRAClient(raCreds.username, raCreds.apiKey);

  // Find all games (typically ROM-based games have emulator configs)
  const games = await prisma.game.findMany({
    select: {
      id: true,
      mName: true,
      libraryPath: true,
    },
  });

  const results: {
    gameId: string;
    gameName: string;
    matched: boolean;
    raGameId?: number;
    raGameName?: string;
    achievements?: number;
    error?: string;
  }[] = [];

  for (const game of games) {
    try {
      // Skip if already has a RA link
      const existingLink = await prisma.gameExternalLink.findUnique({
        where: {
          gameId_provider: {
            gameId: game.id,
            provider: ExternalAccountProvider.RetroAchievements,
          },
        },
      });

      if (existingLink) {
        results.push({
          gameId: game.id,
          gameName: game.mName ?? game.libraryPath,
          matched: false,
          error: "Already linked to RetroAchievements",
        });
        continue;
      }

      // Search RA for this game
      const gameName = game.mName ?? game.libraryPath;
      const searchResults = await raClient.searchGame(gameName);

      if (searchResults.length === 0) {
        results.push({
          gameId: game.id,
          gameName,
          matched: false,
          error: "No matches found on RetroAchievements",
        });
        continue;
      }

      // Use the first result (highest achievement count among filtered results)
      const match = searchResults[0];

      // Fetch achievement definitions
      const gameInfo = await raClient.getGameAchievements(match.ID);
      if (!gameInfo) {
        results.push({
          gameId: game.id,
          gameName,
          matched: false,
          error: "Failed to fetch game info from RetroAchievements",
        });
        continue;
      }

      // Create the external link
      await prisma.gameExternalLink.create({
        data: {
          gameId: game.id,
          provider: ExternalAccountProvider.RetroAchievements,
          externalGameId: String(match.ID),
        },
      });

      // Create achievement definitions
      let achievementCount = 0;
      let order = 0;

      for (const [externalId, achievement] of Object.entries(
        gameInfo.Achievements || {},
      )) {
        const iconUrl = achievement.BadgeName
          ? `https://media.retroachievements.org/Badge/${achievement.BadgeName}.png`
          : "";
        const iconLockedUrl = achievement.BadgeName
          ? `https://media.retroachievements.org/Badge/${achievement.BadgeName}_lock.png`
          : "";

        await prisma.achievement.upsert({
          where: {
            gameId_provider_externalId: {
              gameId: game.id,
              provider: ExternalAccountProvider.RetroAchievements,
              externalId,
            },
          },
          create: {
            gameId: game.id,
            provider: ExternalAccountProvider.RetroAchievements,
            externalId,
            title: achievement.Title || externalId,
            description: achievement.Description || "",
            iconUrl,
            iconLockedUrl,
            displayOrder: order,
          },
          update: {
            title: achievement.Title || externalId,
            description: achievement.Description || "",
            iconUrl,
            iconLockedUrl,
            displayOrder: order,
          },
        });

        achievementCount++;
        order++;
      }

      results.push({
        gameId: game.id,
        gameName,
        matched: true,
        raGameId: match.ID,
        raGameName: match.Title,
        achievements: achievementCount,
      });

      logger.info(
        `[RA Scan] Matched ${gameName} to RA game ${match.Title} (${match.ID}) with ${achievementCount} achievements`,
      );
    } catch (error) {
      logger.warn(
        `[RA Scan] Error processing game ${game.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      results.push({
        gameId: game.id,
        gameName: game.mName ?? game.libraryPath,
        matched: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }

  const matched = results.filter((r) => r.matched);
  logger.info(
    `[RA Scan] Completed: scanned ${games.length} games, matched ${matched.length}`,
  );

  return {
    gamesScanned: games.length,
    gamesMatched: matched.length,
    details: results,
  };
});
