import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  resolveGameVersionDir,
  readGoldbergDefinitions,
  readGoldbergAppId,
} from "~/server/internal/goldberg";

/**
 * Bulk-scans every game in the library for Goldberg steam_settings.
 * For each game that has a steam_settings/achievements.json:
 *   1. Auto-creates a GameExternalLink (provider=Goldberg, externalGameId=AppID)
 *   2. Upserts all achievement definitions from the file
 *
 * This is the "easy button" — one POST and every DRM-free game with
 * Goldberg achievements is fully wired up.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    select: {
      id: true,
      mName: true,
      libraryPath: true,
      library: { select: { backend: true, options: true } },
      versions: {
        where: { versionPath: { not: null } },
        orderBy: { versionIndex: "desc" },
        take: 1,
        select: { versionPath: true },
      },
    },
  });

  const results: {
    gameId: string;
    gameName: string;
    appId: string;
    achievements: number;
  }[] = [];

  for (const game of games) {
    const versionDir = await resolveGameVersionDir(game.id);
    if (!versionDir) continue;

    const definitions = readGoldbergDefinitions(versionDir);
    if (definitions.length === 0) continue;

    // Read AppID — fall back to a sanitised library path if no steam_appid.txt
    const appId = readGoldbergAppId(versionDir) ?? game.libraryPath;

    // Auto-create external link
    await prisma.gameExternalLink.upsert({
      where: {
        gameId_provider: {
          gameId: game.id,
          provider: ExternalAccountProvider.Goldberg,
        },
      },
      create: {
        gameId: game.id,
        provider: ExternalAccountProvider.Goldberg,
        externalGameId: appId,
      },
      update: {
        externalGameId: appId,
      },
    });

    // Upsert achievement definitions
    let count = 0;
    for (const def of definitions) {
      const apiName = def.name ?? "";
      if (!apiName) continue;

      await prisma.achievement.upsert({
        where: {
          gameId_provider_externalId: {
            gameId: game.id,
            provider: ExternalAccountProvider.Goldberg,
            externalId: apiName,
          },
        },
        create: {
          gameId: game.id,
          provider: ExternalAccountProvider.Goldberg,
          externalId: apiName,
          title: def.displayName ?? apiName,
          description: def.description ?? "",
          iconUrl: def.icon ?? "",
          iconLockedUrl: def.icon_gray ?? "",
          displayOrder: count,
        },
        update: {
          title: def.displayName ?? apiName,
          description: def.description ?? "",
          iconUrl: def.icon ?? "",
          iconLockedUrl: def.icon_gray ?? "",
          displayOrder: count,
        },
      });
      count++;
    }

    results.push({
      gameId: game.id,
      gameName: game.mName ?? game.libraryPath,
      appId,
      achievements: count,
    });
  }

  return {
    gamesScanned: games.length,
    gamesWithGoldberg: results.length,
    details: results,
  };
});
