import { ClientCapabilities } from "~/prisma/client/enums";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Returns sync status for a game's save slots.
 * The client uses this before launching a game to decide
 * whether to download, upload, or prompt for conflict resolution.
 *
 * Returns: { slots: [{ index, latestChecksum, lastSyncedAt, historyCount }], savePaths }
 */
export default defineClientEventHandler(
  async (h3, { fetchClient, fetchUser }) => {
    const client = await fetchClient();
    if (!client.capabilities.includes(ClientCapabilities.CloudSaves))
      throw createError({
        statusCode: 403,
        statusMessage: "Capability not allowed.",
      });
    const user = await fetchUser();

    const gameId = getRouterParam(h3, "gameid");
    if (!gameId)
      throw createError({
        statusCode: 400,
        statusMessage: "No gameID in route params",
      });

    const [saves, game] = await Promise.all([
      prisma.saveSlot.findMany({
        where: { userId: user.id, gameId },
        orderBy: { index: "asc" },
        select: {
          index: true,
          historyChecksums: true,
          historyObjectIds: true,
          lastSyncedAt: true,
          lastUsedClientId: true,
        },
      }),
      prisma.game.findUnique({
        where: { id: gameId },
        select: { savePaths: true },
      }),
    ]);

    if (!game)
      throw createError({ statusCode: 404, statusMessage: "Game not found" });

    return {
      savePaths: game.savePaths ?? null,
      slots: saves.map((s) => ({
        index: s.index,
        latestChecksum:
          s.historyChecksums[s.historyChecksums.length - 1] ?? null,
        latestObjectId:
          s.historyObjectIds[s.historyObjectIds.length - 1] ?? null,
        lastSyncedAt: s.lastSyncedAt,
        lastUsedClientId: s.lastUsedClientId,
        historyCount: s.historyObjectIds.length,
      })),
    };
  },
);
