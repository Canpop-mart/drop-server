import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  resolveGameVersionDir,
  readGoldbergDefinitions,
} from "~/server/internal/goldberg";

const ScanRequest = type({
  gameId: "string",
  provider: "'Steam' | 'RetroAchievements' | 'Goldberg'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ScanRequest);

  // Find the external link for this game + provider
  const link = await prisma.gameExternalLink.findUnique({
    where: {
      gameId_provider: {
        gameId: body.gameId,
        provider: body.provider as ExternalAccountProvider,
      },
    },
  });

  if (!link) {
    throw createError({
      statusCode: 404,
      statusMessage: "No external link found for this game and provider.",
    });
  }

  let scanned = 0;

  if (body.provider === "RetroAchievements") {
    scanned = await scanRetroAchievements(body.gameId, link.externalGameId);
  } else if (body.provider === "Steam") {
    scanned = await scanSteamAchievements(body.gameId, link.externalGameId);
  } else if (body.provider === "Goldberg") {
    scanned = await scanGoldbergAchievements(body.gameId);
  }

  return { scanned };
});

async function scanSteamAchievements(
  gameId: string,
  steamAppId: string,
): Promise<number> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey)
    throw createError({
      statusCode: 500,
      statusMessage: "STEAM_API_KEY not configured.",
    });

  // Fetch achievement schema (metadata)
  const schemaUrl = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${steamAppId}&format=json`;
  const schemaRes = await fetch(schemaUrl);

  if (!schemaRes.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to fetch from Steam API.",
    });
  }

  const schemaData = await schemaRes.json();
  const achievements = schemaData?.game?.availableGameStats?.achievements;
  if (!achievements || !Array.isArray(achievements)) return 0;

  // Also fetch global achievement percentages for rarity
  const globalStats: Record<string, number> = {};
  try {
    const globalUrl = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${steamAppId}&format=json`;
    const globalRes = await fetch(globalUrl);
    if (globalRes.ok) {
      const globalData = await globalRes.json();
      const entries = globalData?.achievementpercentages?.achievements ?? [];
      for (const entry of entries) {
        globalStats[entry.name] = entry.percent;
      }
    }
  } catch {
    // Non-critical — skip global stats
  }

  let count = 0;
  for (const ach of achievements) {
    const apiName = String(ach.name ?? "");
    const title = String(ach.displayName ?? apiName);
    const description = String(ach.description ?? "");
    const iconUrl = ach.icon ? String(ach.icon) : "";
    const iconLockedUrl = ach.icongray ? String(ach.icongray) : "";

    await prisma.achievement.upsert({
      where: {
        gameId_provider_externalId: {
          gameId,
          provider: ExternalAccountProvider.Steam,
          externalId: apiName,
        },
      },
      create: {
        gameId,
        provider: ExternalAccountProvider.Steam,
        externalId: apiName,
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder: count,
      },
      update: {
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder: count,
      },
    });
    count++;
  }

  return count;
}

async function scanRetroAchievements(
  gameId: string,
  raGameId: string,
): Promise<number> {
  const apiKey = process.env.RA_API_KEY;
  if (!apiKey)
    throw createError({
      statusCode: 500,
      statusMessage: "RA_API_KEY not configured.",
    });

  const response = await fetch(
    `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?z=_&y=${apiKey}&g=${raGameId}&u=_`,
  );

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to fetch from RetroAchievements API.",
    });
  }

  const data = await response.json();
  if (!data.Achievements) return 0;

  let count = 0;
  for (const [achId, achData] of Object.entries(data.Achievements) as [
    string,
    Record<string, unknown>,
  ][]) {
    const title = String(achData.Title ?? "");
    const description = String(achData.Description ?? "");
    const badgeName = achData.BadgeName ? String(achData.BadgeName) : "";
    const iconUrl = badgeName
      ? `https://media.retroachievements.org/Badge/${badgeName}.png`
      : "";
    const iconLockedUrl = badgeName
      ? `https://media.retroachievements.org/Badge/${badgeName}_lock.png`
      : "";
    const displayOrder =
      typeof achData.DisplayOrder === "number" ? achData.DisplayOrder : count;

    await prisma.achievement.upsert({
      where: {
        gameId_provider_externalId: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
          externalId: String(achId),
        },
      },
      create: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
        externalId: String(achId),
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder,
      },
      update: {
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder,
      },
    });
    count++;
  }

  return count;
}

/**
 * Scan Goldberg achievement definitions from the game's steam_settings
 * directory on the NAS. This reads the static definition file — unlock
 * state is handled separately by the client or session-end sync.
 */
async function scanGoldbergAchievements(gameId: string): Promise<number> {
  const versionDir = await resolveGameVersionDir(gameId);
  if (!versionDir) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Cannot resolve game files on disk. Is the library filesystem-backed?",
    });
  }

  const definitions = readGoldbergDefinitions(versionDir);
  if (definitions.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage:
        "No steam_settings/achievements.json found in game directory.",
    });
  }

  let count = 0;
  for (const def of definitions) {
    const apiName = def.name ?? "";
    if (!apiName) continue;

    const title = def.displayName ?? apiName;
    const description = def.description ?? "";
    const iconUrl = def.icon ?? "";
    const iconLockedUrl = def.icon_gray ?? "";

    await prisma.achievement.upsert({
      where: {
        gameId_provider_externalId: {
          gameId,
          provider: ExternalAccountProvider.Goldberg,
          externalId: apiName,
        },
      },
      create: {
        gameId,
        provider: ExternalAccountProvider.Goldberg,
        externalId: apiName,
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder: count,
      },
      update: {
        title,
        description,
        iconUrl,
        iconLockedUrl,
        displayOrder: count,
      },
    });
    count++;
  }

  return count;
}
