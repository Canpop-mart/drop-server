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
    `[ACH-SCAN] Scan requested for game=${body.gameId} provider=${body.provider} userId=${userId}`,
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
    // Resolve RA credentials: env vars first, then user's linked RA account, then any user
    logger.info(`[ACH-SCAN] Resolving RA credentials for userId=${userId}`);
    const raCreds = await resolveRACredentials(userId);
    if (!raCreds) {
      logger.warn(
        `[ACH-SCAN] No RA credentials found for userId=${userId}. Check UserExternalAccount table.`,
      );
      throw createError({
        statusCode: 500,
        statusMessage:
          "No RetroAchievements credentials available. Either set RA_USERNAME/RA_API_KEY env vars or link your RA account in account settings.",
      });
    }
    logger.info(
      `[ACH-SCAN] Using RA credentials: username=${raCreds.username}`,
    );

    const raClient = createRAClient(raCreds.username, raCreds.apiKey);

    try {
      // Require an existing external link — admin must add the RA game ID first
      const existingLink = await prisma.gameExternalLink.findUnique({
        where: {
          gameId_provider: {
            gameId: body.gameId,
            provider: ExternalAccountProvider.RetroAchievements,
          },
        },
      });

      if (!existingLink) {
        throw createError({
          statusCode: 400,
          statusMessage:
            "No RetroAchievements link found. Add the RA game ID first, then scan.",
        });
      }

      const raGameId = parseInt(existingLink.externalGameId, 10);
      logger.info(
        `[ACH-SCAN] Scanning RA game ${raGameId} for game ${body.gameId}`,
      );

      // Fetch and upsert achievement definitions
      const gameInfo = await raClient.getGameAchievements(raGameId);
      if (!gameInfo) {
        throw createError({
          statusCode: 400,
          statusMessage: `Failed to fetch achievements from RetroAchievements for game ${raGameId}`,
        });
      }

      // Fetch existing achievements to determine create vs update
      const existingAchievements = await prisma.achievement.findMany({
        where: {
          gameId: body.gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
        select: { externalId: true, id: true },
      });
      const existingMap = new Map(
        existingAchievements.map((a) => [a.externalId, a.id]),
      );

      const toCreate = [];
      const toUpdate = [];
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

        const achievementData = {
          title: achievement.Title || externalId,
          description: achievement.Description || "",
          iconUrl,
          iconLockedUrl,
          displayOrder: order,
        };

        if (existingMap.has(externalId)) {
          toUpdate.push({
            id: existingMap.get(externalId)!,
            data: achievementData,
          });
        } else {
          toCreate.push({
            gameId: body.gameId,
            provider: ExternalAccountProvider.RetroAchievements,
            externalId,
            ...achievementData,
          });
        }

        order++;
      }

      // Batch create new achievements
      if (toCreate.length > 0) {
        await prisma.achievement.createMany({ data: toCreate });
      }

      // Batch update existing achievements
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map(({ id, data }) =>
            prisma.achievement.updateMany({ where: { id }, data }),
          ),
        );
      }

      const achievementCount = toCreate.length + toUpdate.length;

      logger.info(
        `[ACH-SCAN] Scanned RA game ${raGameId} for game ${body.gameId}: ${achievementCount} achievements`,
      );

      return { scanned: true, raGameId, achievementCount };
    } catch (e) {
      // Log the actual error server-side before rethrowing
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[ACH-SCAN] RA scan failed: ${msg}`);
      // If it's already an H3 error, rethrow as-is; otherwise wrap it
      if (e && typeof e === "object" && "statusCode" in e) throw e;
      throw createError({
        statusCode: 500,
        statusMessage: `RetroAchievements scan failed: ${msg}`,
      });
    }
  }

  throw createError({ statusCode: 400, statusMessage: "Unknown provider" });
});
