import cacheHandler from "../cache";
import prisma from "../db/database";
import { sum } from "../../../utils/array";
import { createDownloadManifestDetails } from "../library/manifest";
import { castManifest } from "../library/manifest/utils";

export type GameVersionSize = {
  versionId: string;
  installSize: number;
  downloadSize: number;
};

export type GameSizeBreakdown = {
  diskSize: number;
  versions: Array<GameVersionSize & { diskSize: number; name: string }>;
};

class GameSizeManager {
  // Version sizes are effectively immutable (a version's manifest never changes,
  // and a delta size for a fixed (version, previous) pair is stable too), so
  // cache them for a long time rather than the default 5 minutes. Full sizes are
  // also persisted on the GameVersion row (see getVersionSize) and survive
  // restarts, which the in-memory cache does not.
  private gameVersionsSizesCache = cacheHandler.createCache<GameVersionSize>(
    "versionSizes",
    7 * 24 * 60 * 60 * 1000, // 7 days
  );
  private gameBreakdownCache =
    cacheHandler.createCache<GameSizeBreakdown>("gameBreakdown");
  // Disk size is immutable per version (the manifest never changes once
  // imported), so caching it avoids re-pulling + JSON-parsing the entire
  // dropletManifest just to read its top-level `.size`.
  private gameVersionDiskSizeCache =
    cacheHandler.createCache<number>("versionDiskSizes");

  private gameVersionSizeCacheKey(versionId: string, previousId?: string) {
    return `${versionId}${previousId ? `-from-${previousId}` : ""}`;
  }

  /***
   * Gets the size of the game to the user:
   * - installSize: size on disk after install
   * - downloadSize: how many bytes are downloaded (but not necessarily stored)
   */
  async getVersionSize(
    versionId: string,
    previousId?: string,
  ): Promise<GameVersionSize | null> {
    // Full (no-delta) sizes are immutable once imported and are persisted on the
    // row, which survives restarts and cache expiry. Prefer them so the common
    // fresh-install case never re-parses the manifest on the request path (that
    // recompute is what raced the client's 15s timeout and made installs flaky).
    if (!previousId) {
      const row = await prisma.gameVersion.findUnique({
        where: { versionId },
        select: { installSize: true, downloadSize: true },
      });
      if (row?.installSize != null && row?.downloadSize != null)
        return {
          versionId,
          installSize: Number(row.installSize),
          downloadSize: Number(row.downloadSize),
        };
    }

    const key = this.gameVersionSizeCacheKey(versionId, previousId);
    if (await this.gameVersionsSizesCache.has(key))
      return await this.gameVersionsSizesCache.get(key);
    try {
      const { downloadSize, installSize } = await createDownloadManifestDetails(
        versionId,
        previousId,
      );
      const result = {
        downloadSize,
        installSize,
        versionId,
      } satisfies GameVersionSize;
      await this.gameVersionsSizesCache.set(key, result);
      // Backfill the immutable full size onto the row so later lookups skip the
      // manifest parse entirely (self-healing for versions imported before these
      // columns existed).
      if (!previousId) {
        try {
          await prisma.gameVersion.updateMany({
            where: { versionId },
            data: {
              installSize: BigInt(installSize),
              downloadSize: BigInt(downloadSize),
            },
          });
        } catch {
          // Non-critical: the value is cached; persistence retries next time.
        }
      }
      return result;
    } catch {
      return null;
    }
  }

  /***
   * Get the size of the game on disk
   */
  async getVersionDiskSize(versionId: string): Promise<number | null> {
    if (await this.gameVersionDiskSizeCache.has(versionId))
      return await this.gameVersionDiskSizeCache.get(versionId);
    const version = await prisma.gameVersion.findUnique({
      where: {
        versionId,
      },
      select: {
        dropletManifest: true,
      },
    });
    if (!version) return null;
    const size = castManifest(version.dropletManifest).size;
    await this.gameVersionDiskSizeCache.set(versionId, size);
    return size;
  }

  /**
   * Calculate the total disk usage of a game
   * @param gameId Game ID to calculate
   * @returns Total **disk** size of the game
   */
  async getGameDiskSize(gameId: string): Promise<number> {
    const versions = await prisma.gameVersion.findMany({
      where: { gameId },
      select: {
        versionId: true,
      },
    });
    const sizes = await Promise.all(
      versions.map((version) => this.getVersionDiskSize(version.versionId)),
    );
    return sum(sizes.filter((v) => v !== null));
  }

  async getGameBreakdown(gameId: string): Promise<GameSizeBreakdown | null> {
    const versions = await prisma.gameVersion.findMany({
      where: { gameId },
      orderBy: { versionIndex: "desc" },
      select: { versionId: true, displayName: true, versionPath: true },
    });
    if (!versions) return null;

    const breakdownKey = `${gameId} ${versions.map((v) => v.versionId).join(" ")}`;

    if (await this.gameBreakdownCache.has(breakdownKey))
      return (await this.gameBreakdownCache.get(breakdownKey))!;

    let diskSize = 0;
    const versionInformation = [];
    for (const version of versions) {
      const size = (await this.getVersionSize(version.versionId))!;
      const vDiskSize = (await this.getVersionDiskSize(version.versionId))!;
      diskSize += vDiskSize;
      versionInformation.push({
        ...size,
        diskSize: vDiskSize,
        name: (version.displayName ?? version.versionPath)!,
      });
    }
    const result = {
      diskSize,
      versions: versionInformation,
    };
    await this.gameBreakdownCache.set(breakdownKey, result);
    return result;
  }
}

export const gameSizeManager = new GameSizeManager();
export default gameSizeManager;
