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
  provider: "'Goldberg'",
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

  const scanned = await scanGoldbergAchievements(body.gameId);
  return { scanned };
});

/**
 * Scan Goldberg achievement definitions from the game's steam_settings
 * directory on the NAS. This reads the static definition file — unlock
 * state is handled separately by the client.
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
