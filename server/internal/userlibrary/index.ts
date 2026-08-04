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
    // Read across ALL of the user's default collections, not just one. Nothing
    // in the schema enforces a single default per user (there is no unique index
    // on userId + isDefault), and the find-or-create in `fetchUserLibrary` has a
    // race that can leave a user with two "default" libraries. Games added while
    // the other default was the active one then vanished from this view even
    // though the store still reported them as "in library" — the store treats
    // membership as belonging to ANY of the user's collections
    // (store/recommended.get.ts), so the two disagreed. Aggregating every
    // default reconciles them.
    const primaryId = await this.fetchUserLibrary(userId);
    const defaults = await prisma.collection.findMany({
      where: { userId, isDefault: true },
    });
    const primary = defaults.find((c) => c.id === primaryId) ?? defaults[0];
    if (!primary) throw new Error("Failed to load user library");

    return await this.attachEntries(
      primary,
      defaults.map((c) => c.id),
    );
  }

  // Will not return the default library
  async fetchCollection(collectionId: string) {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId, isDefault: false },
    });
    if (!collection) return null;

    return await this.attachEntries(collection);
  }

  async fetchCollections(
    userId: string,
    opts: { excludeFeatured?: boolean } = {},
  ) {
    await this.fetchUserLibrary(userId); // Ensures user library exists, doesn't have much performance impact due to caching
    const collections = await prisma.collection.findMany({
      where: {
        userId,
        isDefault: false,
        // Curated (featured) collections are store content — exclude them
        // from the user's personal library feed when asked.
        ...(opts.excludeFeatured ? { featured: false } : {}),
      },
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
   * Attaches entries with games to a collection, avoiding lateral joins.
   *
   * `entryCollectionIds` defaults to the collection's own id, but callers may
   * pass several ids to aggregate entries from more than one collection into a
   * single view — `fetchLibrary` uses this to merge a user's default
   * collections when a duplicate exists. Games are de-duplicated by id so a
   * game present in two of those collections is not listed twice.
   */
  private async attachEntries<T extends { id: string }>(
    collection: T,
    entryCollectionIds: string[] = [collection.id],
  ): Promise<T & { entries: (CollectionEntry & { game: Game })[] }> {
    const entries = await prisma.collectionEntry.findMany({
      where: { collectionId: { in: entryCollectionIds } },
    });

    const gameIds = [...new Set(entries.map((e) => e.gameId))];
    const games =
      gameIds.length > 0
        ? await prisma.game.findMany({ where: { id: { in: gameIds } } })
        : [];
    const gameMap = new Map(games.map((g) => [g.id, g]));

    const seen = new Set<string>();
    const attachedEntries: (CollectionEntry & { game: Game })[] = [];
    for (const entry of entries) {
      if (seen.has(entry.gameId)) continue;
      const game = gameMap.get(entry.gameId);
      if (!game) continue;
      seen.add(entry.gameId);
      attachedEntries.push({ ...entry, game });
    }

    return { ...collection, entries: attachedEntries };
  }

  async collectionAdd(gameId: string, collectionId: string, userId: string) {
    // Authz: the collection must belong to the caller. A relation filter inside
    // an upsert.where does NOT gate the `create` branch — a non-owned collection
    // misses the unique lookup and falls through to an unconditional insert — so
    // ownership has to be verified explicitly (matches collectionRemove's intent).
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      select: { userId: true },
    });
    if (!collection)
      throw createError({
        statusCode: 404,
        statusMessage: "Collection not found",
      });
    if (collection.userId !== userId)
      throw createError({ statusCode: 403, statusMessage: "Forbidden" });

    // Resolve the game up front so a bad id is a clean 404 rather than an opaque
    // foreign-key 500 from the insert below.
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game)
      throw createError({ statusCode: 404, statusMessage: "Game not found" });

    const entry = await prisma.collectionEntry.upsert({
      where: { collectionId_gameId: { collectionId, gameId } },
      create: { collectionId, gameId },
      update: {},
    });
    return { ...entry, game };
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
