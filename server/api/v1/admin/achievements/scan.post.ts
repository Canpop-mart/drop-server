import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

const ScanRequest = type({
  gameId: "string",
  provider: "'Steam' | 'RetroAchievements'",
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
  }

  return { scanned };
});

async function scanRetroAchievements(gameId: string, raGameId: string): Promise<number> {
  const apiKey = process.env.RA_API_KEY;
  if (!apiKey) throw createError({ statusCode: 500, statusMessage: "RA_API_KEY not configured." });

  const response = await fetch(
    `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?z=_&y=${apiKey}&g=${raGameId}&u=_`
  );

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: "Failed to fetch from RetroAchievements API." });
  }

  const data = await response.json();
  if (!data.Achievements) return 0;

  let count = 0;
  for (const [achId, achData] of Object.entries(data.Achievements) as [string, Record<string, string | number>][]) {
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
        title: achData.Title || "",
        description: achData.Description || "",
        iconUrl: achData.BadgeName
          ? `https://media.retroachievements.org/Badge/${achData.BadgeName}.png`
          : "",
        iconLockedUrl: achData.BadgeName
          ? `https://media.retroachievements.org/Badge/${achData.BadgeName}_lock.png`
          : "",
        displayOrder: achData.DisplayOrder ?? count,
      },
      update: {
        title: achData.Title || "",
        description: achData.Description || "",
        iconUrl: achData.BadgeName
          ? `https://media.retroachievements.org/Badge/${achData.BadgeName}.png`
          : "",
        iconLockedUrl: achData.BadgeName
          ? `https://media.retroachievements.org/Badge/${achData.BadgeName}_lock.png`
          : "",
        displayOrder: achData.DisplayOrder ?? count,
      },
    });
    count++;
  }

  return count;
}
