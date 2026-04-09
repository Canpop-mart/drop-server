import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  getSteamGridDBApiKey,
  sgdbGetBestLogoUrl,
} from "~/server/internal/metadata/steamgriddb";
import { ObjectTransactionalHandler } from "~/server/internal/objects/transactional";
import { logger } from "~/server/internal/logging";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const apiKey = getSteamGridDBApiKey();
  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "STEAMGRIDDB_API_KEY not configured",
    });
  }

  try {
    // Find games without logos
    const games = await prisma.game.findMany({
      where: { mLogoObjectId: "" },
      select: {
        id: true,
        mName: true,
        metadataSource: true,
        metadataId: true,
        externalLinks: {
          where: { provider: ExternalAccountProvider.Goldberg },
          select: { externalGameId: true },
        },
      },
    });

    logger.info(
      `Starting logo backfill for ${games.length} games without logos`,
    );

    const results: {
      gameId: string;
      name: string;
      success: boolean;
      error?: string;
    }[] = [];
    const objectHandler = new ObjectTransactionalHandler();

    for (const game of games) {
      try {
        // Determine Steam App ID
        let steamAppId: string | undefined;
        if (game.externalLinks.length > 0) {
          steamAppId = game.externalLinks[0].externalGameId;
        } else if (game.metadataSource === "Steam") {
          steamAppId = game.metadataId;
        }

        logger.info(
          `Processing game "${game.mName}" (${game.id})${steamAppId ? ` with Steam App ID ${steamAppId}` : ""}`,
        );

        const logoUrl = await sgdbGetBestLogoUrl(
          apiKey,
          steamAppId,
          game.mName,
        );
        if (!logoUrl) {
          logger.warn(`No logo found on SteamGridDB for "${game.mName}"`);
          results.push({
            gameId: game.id,
            name: game.mName,
            success: false,
            error: "No logo found",
          });
          continue;
        }

        // Download the logo image
        const response = await fetch(logoUrl);
        if (!response.ok) {
          logger.warn(
            `Failed to download logo for "${game.mName}": ${response.status}`,
          );
          results.push({
            gameId: game.id,
            name: game.mName,
            success: false,
            error: `Download failed: ${response.status}`,
          });
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());

        const [createObject, pullObjects] = objectHandler.new({}, [
          "internal:read",
        ]);
        const objectRef = createObject(buffer);
        await pullObjects();

        const { count } = await prisma.game.updateMany({
          where: { id: game.id },
          data: { mLogoObjectId: objectRef },
        });
        if (count === 0) {
          results.push({
            gameId: game.id,
            name: game.mName,
            success: false,
            error: "Game not found during update",
          });
          continue;
        }

        logger.info(`Successfully backfilled logo for "${game.mName}"`);
        results.push({ gameId: game.id, name: game.mName, success: true });
      } catch (e) {
        logger.error(
          `Error processing game "${game.mName}": ${e instanceof Error ? e.message : String(e)}`,
        );
        results.push({
          gameId: game.id,
          name: game.mName,
          success: false,
          error: String(e),
        });
      }
    }

    logger.info(
      `Logo backfill complete: ${results.filter((r) => r.success).length}/${games.length} successful`,
    );

    return {
      total: games.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  } catch (e) {
    logger.error(
      `Logo backfill failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
});
