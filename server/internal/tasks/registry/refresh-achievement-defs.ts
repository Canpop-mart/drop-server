import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { resolveGameVersionDir, setupGoldberg } from "../../goldberg";

/**
 * Re-pulls Steam achievement definitions for every Steam/Goldberg game,
 * refreshing titles, descriptions, and icon URLs. Reuses `setupGoldberg`
 * with `forceRefreshAchievements: true`.
 *
 * Independent from Goldberg readiness — if the Steam API is flaky, only
 * this task fails, not the readiness scan or the RA link pass.
 */
export default defineDropTask({
  buildId: () => `refresh:achievement-defs:${new Date().toISOString()}`,
  name: "Refresh Achievement Definitions",
  acls: ["system:maintenance:read"],
  taskGroup: "refresh:achievement-defs",

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
      select: { id: true, mName: true },
    });

    logger.info(`Refreshing definitions for ${games.length} game(s)`);

    let refreshed = 0;
    let failed = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      try {
        await setupGoldberg(game.id, versionDir, {
          forceRefreshAchievements: true,
        });
        refreshed++;
      } catch (e) {
        logger.info(`${game.mName} — refresh failed: ${e}`);
        failed++;
      }

      progress(Math.round(((i + 1) / games.length) * 100));
      // Steam API has a per-IP rate limit; 500ms is comfortable.
      await new Promise((r) => setTimeout(r, 500));
    }

    logger.info(`Definitions: ${refreshed} refreshed, ${failed} failed`);
  },
});
