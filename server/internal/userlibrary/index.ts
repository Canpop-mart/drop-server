/*
Handles managing collections
*/

import type { CollectionEntry, Game } from "~/prisma/client/client";
import cacheHandler from "../cache";
import prisma from "../db/database";

class UserLibraryManager {
  // Caches the user's core library
  private coreLibraryCache =
    cacheHandler.createCache<string>("UserCoreLibrary");

  private async fetchUserLibrary(userId: string) {
    const cached = await this.coreLibraryCache.get(userId);
    if (cached !== null) return cached;

    let collection = await prisma.collection.findFirst({
      where: {
        userId,
        isDefault: true,
      },
    });

    if (!collection)
      collection = await prisma.collection.create({
        data: {
          name: "Library",
          userId,
          isDefault: true,
        },
      });

    await this.coreLibraryCache.set(userId, collection.id);

    return collection.id;
  }

  async libraryAdd(gameId: string, userId: string) {
    const userLibraryId = await this.fetchUserLibrary(userId);
    await this.collectionAdd(gameId, userLibraryId, userId);
  }

  async libraryRemove(gameId: string, userId: string) {
    const userLibraryId = await this.fetchUserLibrary(userId);
    await this.collectionRemove(gameId, userLibraryId, userId);
  }

  async fetchLibrary(userId: string) {
    const userLibraryId = await this.fetchUserLibrary(userId);
    const userLibrary = await prisma.collection.findUnique({
      where: { id: userLibraryId },
    });
    if (!userLibrary) throw new Error("Failed to load user library");

    return await this.attachEntries(userLibrary);
  }

  // Will not return the default library
  async fetchCollection(collectionId: string) {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId, isDefault: false },
    });
    if (!collection) return null;

    return await this.attachEntries(collection);
  }

  async fetchCollections(userId: string) {
    await this.fetchUserLibrary(userId); // Ensures user library exists, doesn't have much performance impact due to caching
    const collections = await prisma.collection.findMany({
      where: { userId, isDefault: false },
    });

    if (collections.length === 0) return [];

    const collectionIds = collections.map((c) => c.id);

    // Batch-fetch all entries for all collections
    const entries = await prisma.collectionEntry.findMany({
      where: { collectionId: { in: collectionIds } },
    });

    // Batch-fetch all referenced games
    const gameIds = [...new Set(entries.map((e) => e.gameId))];
    const games =
      gameIds.length > 0
        ? await prisma.game.findMany({ where: { id: { in: gameIds } } })
        : [];
    const gameMap = new Map(games.map((g) => [g.id, g]));

    // Stitch together
    const entriesByCollection = new Map<
      string,
      Array<(typeof entries)[number] & { game: (typeof games)[number] }>
    >();
    for (const entry of entries) {
      const game = gameMap.get(entry.gameId);
      if (!game) continue;
      const arr = entriesByCollection.get(entry.collectionId) ?? [];
      arr.push({ ...entry, game });
      entriesByCollection.set(entry.collectionId, arr);
    }

    return collections.map((c) => ({
      ...c,
      entries: entriesByCollection.get(c.id) ?? [],
    }));
  }

  /**
   * Attaches entries with games to a single collection, avoiding lateral joins.
   */
  private async attachEntries<T extends { id: string }>(
    collection: T,
  ): Promise<T & { entries: (CollectionEntry & { game: Game })[] }> {
    const entries = await prisma.collectionEntry.findMany({
      where: { collectionId: collection.id },
    });

    const gameIds = entries.map((e) => e.gameId);
    const games =
      gameIds.length > 0
        ? await prisma.game.findMany({ where: { id: { in: gameIds } } })
        : [];
    const gameMap = new Map(games.map((g) => [g.id, g]));

    return {
      ...collection,
      entries: entries
        .filter((e) => gameMap.has(e.gameId))
        .map((e) => ({ ...e, game: gameMap.get(e.gameId)! })),
    };
  }

  async collectionAdd(gameId: string, collectionId: string, userId: string) {
    const entry = await prisma.collectionEntry.upsert({
      where: {
        collectionId_gameId: {
          collectionId,
          gameId,
        },
        collection: {
          userId,
        },
      },
      create: {
        collectionId,
        gameId,
      },
      update: {},
    });
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    return { ...entry, game: game! };
  }

  async collectionRemove(gameId: string, collectionId: string, userId: string) {
    // Delete if exists
    const { count } = await prisma.collectionEntry.deleteMany({
      where: {
        collectionId,
        gameId,
        collection: {
          userId,
        },
      },
    });
    return count > 0;
  }

  async collectionCreate(name: string, userId: string) {
    const collection = await prisma.collection.create({
      data: {
        name,
        userId: userId,
      },
    });
    // New collection always has empty entries
    return {
      ...collection,
      entries: [] as (CollectionEntry & { game: Game })[],
    };
  }

  async deleteCollection(collectionId: string) {
    const { count } = await prisma.collection.deleteMany({
      where: {
        id: collectionId,
        isDefault: false,
      },
    });
    return count > 0;
  }
}

export const userLibraryManager = new UserLibraryManager();
export default userLibraryManager;
