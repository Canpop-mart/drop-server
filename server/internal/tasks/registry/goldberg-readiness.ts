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
 * Walks every Steam / Goldberg-linked game and verifies the files Goldberg
 * needs at runtime (steam_settings/, steam_appid.txt, achievements.json) plus
 * the matching DB rows. Any gap triggers a `setupGoldberg` pass to regenerate.
 *
 * Split out of the former `scan:achievements` umbrella so a failure here
 * doesn't block definition refresh or RA linking.
 */
export default defineDropTask({
  buildId: () => `scan:goldberg-readiness:${new Date().toISOString()}`,
  name: "Scan Goldberg Readiness",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:goldberg-readiness",

  async run({ progress, logger }) {
    const games = await prisma.game.findMany({
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
        _count: { select: { achievements: true } },
      },
    });

    logger.info(`Checking ${games.length} Steam/Goldberg game(s)`);

    let healthy = 0;
    let fixed = 0;
    let issues = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const appId =
        game.externalLinks[0]?.externalGameId ??
        (game.metadataSource === "Steam" ? game.metadataId : null);

      if (!appId) {
        logger.info(`${game.mName} — no AppID, skipping`);
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        logger.info(`${game.mName} — no version directory, skipping`);
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      const hasAppIdFile = !!readGoldbergAppId(versionDir);
      const hasAchievementsFile = readGoldbergDefinitions(versionDir).length > 0;
      const hasDbRecords = game._count.achievements > 0;
      const hasSteamSettings = fs.existsSync(path.join(versionDir, "steam_settings"));

      const allGood =
        hasAppIdFile && hasAchievementsFile && hasDbRecords && hasSteamSettings;

      if (allGood) {
        healthy++;
      } else {
        const missing: string[] = [];
        if (!hasSteamSettings) missing.push("steam_settings/");
        if (!hasAppIdFile) missing.push("steam_appid.txt");
        if (!hasAchievementsFile) missing.push("achievements.json");
        if (!hasDbRecords) missing.push("DB records");
        logger.info(
          `${game.mName} — missing: ${missing.join(", ")}. Running setup...`,
        );

        try {
          await setupGoldberg(game.id, versionDir, {
            forceRefreshAchievements: true,
          });
          const dbCount = await prisma.achievement.count({
            where: { gameId: game.id },
          });
          logger.info(`${game.mName} — fixed (${dbCount} achievements in DB)`);
          fixed++;
        } catch (e) {
          logger.info(`${game.mName} — setup failed: ${e}`);
          issues++;
        }
      }

      progress(Math.round(((i + 1) / games.length) * 100));
      await new Promise((r) => setTimeout(r, 200));
    }

    logger.info(
      `Goldberg readiness: ${healthy} healthy, ${fixed} fixed, ${issues} issue(s) across ${games.length} game(s)`,
    );
  },
});
