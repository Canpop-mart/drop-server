import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { readableSaveScope } from "~/server/internal/cloudsaves/scope";
import {
  summariseByGame,
  type GameSaveSummary,
} from "~/server/internal/cloudsaves/summary";

/**
 * GET /api/v1/client/saves/summary
 *
 * One row per game the signed-in user has cloud saves for: how many files,
 * how big, and when they last reached the server. Metadata only, no blobs.
 *
 * Reads are per user (`internal/cloudsaves/scope.ts`), so `ownCount` /
 * `ownBytes` now always equal `fileCount` / `totalBytes` and `sharedCount` is
 * always 0. All of them stay in the response for older clients.
 *
 * `list.get.ts` is gameId-only, so the only way to answer "are my saves backed
 * up" was to open one game at a time and wait out a Ludusavi scan for each.
 * This is the library-wide answer behind the Cloud Saves settings page.
 *
 * Same read scope as `list` and `sync-check`, through the same helpers.
 */
export default defineClientEventHandler(
  async (h3, { fetchUser }): Promise<GameSaveSummary[]> => {
    const user = await fetchUser();
    const userId = user.id;

    // Tombstones are hidden here for the same reason as in `list`: the figure
    // has to match what the user thinks of as "their saves".
    const saves = await prisma.cloudSave.findMany({
      where: { deletedAt: null, ...readableSaveScope(userId) },
      select: {
        id: true,
        userId: true,
        user: { select: { displayName: true } },
        gameId: true,
        game: { select: { mName: true } },
        filename: true,
        saveType: true,
        size: true,
        clientModifiedAt: true,
        uploadedAt: true,
      },
    });

    return summariseByGame(saves, userId);
  },
);
