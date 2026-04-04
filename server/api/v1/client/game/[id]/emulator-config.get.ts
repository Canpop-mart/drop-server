import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Returns emulator configuration that the client writes to disk before
 * every game launch. This makes Drop the single source of truth for
 * achievement definitions and AppIDs — no more scanning local files.
 *
 * Response shape:
 * {
 *   appId: string | null,           // Steam AppID from GameExternalLink
 *   achievements: GoldbergDef[],    // Goldberg-format definitions
 * }
 *
 * The client writes:
 *   steam_settings/steam_appid.txt
 *   steam_settings/achievements.json
 *   steam_settings/configs.user.ini  (already handled separately)
 *   drop-goldberg/<AppID>/           (directory created for runtime saves)
 */
export default defineClientEventHandler(async (h3) => {
  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Get the Goldberg external link (AppID)
  const externalLink = await prisma.gameExternalLink.findFirst({
    where: { gameId, provider: "Goldberg" },
  });

  const appId = externalLink?.externalGameId ?? null;

  // Get all Goldberg achievement definitions for this game
  const achievements = await prisma.achievement.findMany({
    where: { gameId, provider: "Goldberg" },
    orderBy: { displayOrder: "asc" },
  });

  // Transform to Goldberg JSON format (what the emulator expects on disk)
  const goldbergDefs = achievements.map((a) => ({
    name: a.externalId,
    displayName: a.title,
    description: a.description,
    icon: a.iconUrl || undefined,
    icon_gray: a.iconLockedUrl || undefined,
    hidden: 0,
  }));

  console.log(
    `[EMU-CONFIG] Served: game=${gameId} appId=${appId} achievements=${goldbergDefs.length}`,
  );

  return {
    appId,
    achievements: goldbergDefs,
  };
});
