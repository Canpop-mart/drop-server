import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

const LinkRAGame = type({
  raGameId: "number",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId) {
    throw createError({ statusCode: 400, statusMessage: "No game ID." });
  }

  const body = await readDropValidatedBody(h3, LinkRAGame);

  const raCreds = await resolveRACredentials(userId);
  if (!raCreds) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "RetroAchievements not configured. Set RA_USERNAME/RA_API_KEY or link your RA account in Settings.",
    });
  }

  const raClient = createRAClient(raCreds.username, raCreds.apiKey);

  // Fetch game info and achievements from RA
  const gameInfo = await raClient.getGameAchievements(body.raGameId);
  if (!gameInfo) {
    throw createError({
      statusCode: 400,
      statusMessage: `Game not found on RetroAchievements: ${body.raGameId}`,
    });
  }

  // Create or update the game external link
  const link = await prisma.gameExternalLink.upsert({
    where: {
      gameId_provider: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
    create: {
      gameId,
      provider: ExternalAccountProvider.RetroAchievements,
      externalGameId: String(body.raGameId),
    },
    update: {
      externalGameId: String(body.raGameId),
    },
  });

  // Upsert achievement definitions
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
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
          externalId,
        },
      },
      create: {
        gameId,
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
    `Linked game ${gameId} to RetroAchievements game ${body.raGameId} with ${achievementCount} achievements`,
  );

  return {
    gameId,
    raGameId: body.raGameId,
    externalLink: link,
    achievementCount,
  };
});
