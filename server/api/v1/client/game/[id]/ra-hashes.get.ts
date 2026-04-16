import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

/// How old cached hashes can be before we refresh them (24 hours).
const HASH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/v1/client/game/{id}/ra-hashes
 *
 * Returns the list of valid RetroAchievements ROM hashes for this game,
 * along with the RA console ID (needed by RAHasher on the client).
 *
 * Response:
 *   { consoleId: number | null, hashes: [{ hash, label, patchUrl }] }
 *
 * Hashes are cached in GameExternalHash and refreshed every 24 hours.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Find the RA external link for this game
  const link = await prisma.gameExternalLink.findUnique({
    where: {
      gameId_provider: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
  });

  if (!link) {
    // Game isn't linked to RA — return empty
    return { consoleId: null, hashes: [] };
  }

  const raGameId = parseInt(link.externalGameId, 10);

  // Check if we have recent cached hashes
  const cached = await prisma.gameExternalHash.findMany({
    where: {
      gameId,
      provider: ExternalAccountProvider.RetroAchievements,
    },
    orderBy: { cachedAt: "desc" },
  });

  const isFresh =
    cached.length > 0 &&
    cached[0].cachedAt.getTime() > Date.now() - HASH_CACHE_TTL_MS;

  if (isFresh) {
    return {
      consoleId: link.consoleId,
      hashes: cached.map((h) => ({
        hash: h.hash,
        label: h.label,
        patchUrl: h.patchUrl,
      })),
    };
  }

  // Refresh from RA API
  const raCreds = await resolveRACredentials(user.id);
  if (!raCreds) {
    // Can't refresh — return stale cache if available
    logger.warn(
      `[RA-HASHES] No RA credentials to refresh hashes for game ${gameId}`,
    );
    return {
      consoleId: link.consoleId,
      hashes: cached.map((h) => ({
        hash: h.hash,
        label: h.label,
        patchUrl: h.patchUrl,
      })),
    };
  }

  const raClient = createRAClient(raCreds.username, raCreds.apiKey);

  try {
    const freshHashes = await raClient.getGameHashes(raGameId);

    // Also update consoleId if missing
    if (!link.consoleId) {
      const gameInfo = await raClient.getGameInfo(raGameId);
      if (gameInfo?.ConsoleID) {
        await prisma.gameExternalLink.updateMany({
          where: { id: link.id },
          data: { consoleId: gameInfo.ConsoleID },
        });
      }
    }

    // Replace cached hashes
    await prisma.gameExternalHash.deleteMany({
      where: { gameId, provider: ExternalAccountProvider.RetroAchievements },
    });

    for (const h of freshHashes) {
      await prisma.gameExternalHash.create({
        data: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
          hash: h.MD5,
          label: h.Name ?? "",
          patchUrl: h.PatchUrl ?? "",
        },
      });
    }

    logger.info(
      `[RA-HASHES] Refreshed ${freshHashes.length} hashes for game ${gameId} (RA ${raGameId})`,
    );

    return {
      consoleId:
        link.consoleId ??
        (
          await prisma.gameExternalLink.findUnique({
            where: { id: link.id },
          })
        )?.consoleId ??
        null,
      hashes: freshHashes.map((h) => ({
        hash: h.MD5,
        label: h.Name ?? "",
        patchUrl: h.PatchUrl ?? "",
      })),
    };
  } catch (e) {
    logger.warn(
      `[RA-HASHES] Failed to refresh hashes for game ${gameId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    // Return stale cache
    return {
      consoleId: link.consoleId,
      hashes: cached.map((h) => ({
        hash: h.hash,
        label: h.label,
        patchUrl: h.patchUrl,
      })),
    };
  }
});
