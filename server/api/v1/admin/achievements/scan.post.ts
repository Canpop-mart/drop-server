import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  resolveGameVersionDir,
  setupGoldberg,
} from "~/server/internal/goldberg";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

const ScanRequest = type({
  gameId: "string",
  provider: "'Goldberg' | 'RetroAchievements'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ScanRequest);

  logger.info(
    `[ACH-SCAN] Scan requested for game=${body.gameId} provider=${body.provider}`,
  );

  if (body.provider === "Goldberg") {
    const versionDir = await resolveGameVersionDir(body.gameId);
    if (!versionDir) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "Cannot resolve game files on disk. Is the library filesystem-backed?",
      });
    }

    // setupGoldberg handles the full pipeline:
    // local file → Steam API fallback → write to disk → DB records
    await setupGoldberg(body.gameId, versionDir);

    return { scanned: true };
  }

  if (body.provider === "RetroAchievements") {
    // Resolve RA credentials: env vars first, then user's linked RA account
    const raCreds = await resolveRACredentials(userId);
    if (!raCreds) {
      throw createError({
        statusCode: 500,
        statusMessage:
          "No RetroAchievements credentials available. Either set RA_USERNAME/RA_API_KEY env vars or link your RA account in account settings.",
      });
    }

    const raClient = createRAClient(raCreds.username, raCreds.apiKey);

    // Get game name for RA search
    const game = await prisma.game.findUnique({
      where: { id: body.gameId },
      select: { mName: true, libraryPath: true },
    });

    if (!game) {
      throw createError({ statusCode: 404, statusMessage: "Game not found" });
    }

    const gameName = game.mName ?? game.libraryPath;

    // Check if already linked — if so, refresh existing achievements
    const existingLink = await prisma.gameExternalLink.findUnique({
      where: {
        gameId_provider: {
          gameId: body.gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });

    let raGameId: number;

    if (existingLink) {
      raGameId = parseInt(existingLink.externalGameId, 10);
    } else {
      // Search RA for this game
      const searchResults = await raClient.searchGame(gameName);
      if (searchResults.length === 0) {
        throw createError({
          statusCode: 404,
          statusMessage: `No RetroAchievements match found for "${gameName}"`,
        });
      }
      raGameId = searchResults[0].ID;

      // Create the external link
      await prisma.gameExternalLink.create({
        data: {
          gameId: body.gameId,
          provider: ExternalAccountProvider.RetroAchievements,
          externalGameId: String(raGameId),
        },
      });
    }

    // Fetch and upsert achievement definitions
    const gameInfo = await raClient.getGameAchievements(raGameId);
    if (!gameInfo) {
      throw createError({
        statusCode: 400,
        statusMessage: `Failed to fetch achievements from RetroAchievements for game ${raGameId}`,
      });
    }

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
            gameId: body.gameId,
            provider: ExternalAccountProvider.RetroAchievements,
            externalId,
          },
        },
        create: {
          gameId: body.gameId,
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

    logger.info(
      `[ACH-SCAN] Scanned RA game ${raGameId} for game ${body.gameId}: ${achievementCount} achievements`,
    );

    return { scanned: true, raGameId, achievementCount };
  }

  throw createError({ statusCode: 400, statusMessage: "Unknown provider" });
});
