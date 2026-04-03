import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  readGoldbergAppId,
  readGoldbergDefinitions,
  resolveGameVersionDir,
  setupGoldberg,
} from "../../goldberg";
import fs from "fs";
import path from "path";

/**
 * Checks every game's Goldberg readiness — verifies that each game with
 * a Steam AppID has the files and DB records needed for achievements to
 * work when the client installs them.
 *
 * For each game it checks:
 *   1. Is there a GameExternalLink (Goldberg provider) or a Steam metadata source?
 *   2. Does the version directory have steam_settings/steam_appid.txt?
 *   3. Does the version directory have steam_settings/achievements.json?
 *   4. Are the achievements imported into the DB?
 *
 * If anything is missing and can be auto-fixed, it runs setupGoldberg()
 * to fill in the gaps. Games that can't be fixed are reported.
 */
export default defineDropTask({
  buildId: () => `check:goldberg-status:${new Date().toISOString()}`,
  name: "Check Goldberg Achievement Status",
  acls: ["system:maintenance:read"],
  taskGroup: "check:goldberg-status",

  async run({ progress, logger }) {
    logger.info("Starting Goldberg achievement status check");

    // Find all games that could have Goldberg achievements:
    // - Games with a Goldberg external link, OR
    // - Games sourced from Steam (metadataId = Steam AppID)
    const gamesWithLinks = await prisma.game.findMany({
      where: {
        OR: [
          {
            externalLinks: {
              some: { provider: ExternalAccountProvider.Goldberg },
            },
          },
          { metadataSource: "Steam" },
        ],
      },
      select: {
        id: true,
        mName: true,
        metadataSource: true,
        metadataId: true,
        externalLinks: {
          where: { provider: ExternalAccountProvider.Goldberg },
          select: { externalGameId: true },
        },
        _count: {
          select: { achievements: true },
        },
      },
    });

    if (gamesWithLinks.length === 0) {
      logger.info("No games with Goldberg links or Steam metadata found");
      progress(100);
      return;
    }

    logger.info(
      `Checking ${gamesWithLinks.length} game(s) for Goldberg readiness`,
    );

    let checked = 0;
    let healthy = 0;
    let fixed = 0;
    let issues = 0;

    for (const game of gamesWithLinks) {
      const appId =
        game.externalLinks[0]?.externalGameId ??
        (game.metadataSource === "Steam" ? game.metadataId : null);

      if (!appId) {
        logger.info(`${game.mName} — no AppID available, skipping`);
        checked++;
        progress(Math.round((checked / gamesWithLinks.length) * 90));
        continue;
      }

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        logger.info(`${game.mName} — no filesystem version found, skipping`);
        checked++;
        progress(Math.round((checked / gamesWithLinks.length) * 90));
        continue;
      }

      // Check what's present
      const hasAppIdFile = !!readGoldbergAppId(versionDir);
      const localDefs = readGoldbergDefinitions(versionDir);
      const hasAchievementsFile = localDefs.length > 0;
      const hasDbRecords = game._count.achievements > 0;
      const steamSettingsDir = path.join(versionDir, "steam_settings");
      const hasSteamSettings = fs.existsSync(steamSettingsDir);

      const allGood =
        hasAppIdFile && hasAchievementsFile && hasDbRecords && hasSteamSettings;

      if (allGood) {
        logger.info(
          `${game.mName} — OK (AppID ${appId}, ${game._count.achievements} achievements)`,
        );
        healthy++;
      } else {
        // Report what's missing
        const missing: string[] = [];
        if (!hasSteamSettings) missing.push("steam_settings/");
        if (!hasAppIdFile) missing.push("steam_appid.txt");
        if (!hasAchievementsFile) missing.push("achievements.json");
        if (!hasDbRecords) missing.push("DB records");

        logger.info(
          `${game.mName} — missing: ${missing.join(", ")}. Running setup...`,
        );

        try {
          await setupGoldberg(game.id, versionDir);

          // Re-check after setup
          const nowHasAppId = !!readGoldbergAppId(versionDir);
          const nowHasDefs = readGoldbergDefinitions(versionDir).length > 0;
          const dbCount = await prisma.achievement.count({
            where: { gameId: game.id },
          });

          if (nowHasAppId && (nowHasDefs || dbCount > 0)) {
            logger.info(
              `${game.mName} — fixed (${dbCount} achievements now in DB)`,
            );
            fixed++;
          } else {
            logger.info(
              `${game.mName} — setup ran but still incomplete (appId=${nowHasAppId}, defs=${nowHasDefs}, db=${dbCount}). May need manual attention or STEAM_API_KEY.`,
            );
            issues++;
          }
        } catch (e) {
          logger.info(`${game.mName} — setup failed: ${e}`);
          issues++;
        }
      }

      checked++;
      progress(Math.round((checked / gamesWithLinks.length) * 90));

      // Small delay between games
      await new Promise((r) => setTimeout(r, 200));
    }

    logger.info(
      `Done — ${healthy} healthy, ${fixed} fixed, ${issues} issue(s) across ${gamesWithLinks.length} game(s)`,
    );
    progress(100);
  },
});
