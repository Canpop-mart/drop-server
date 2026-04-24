import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { createRAClient, resolveRACredentials } from "../../retroachievements";

/**
 * Searches RetroAchievements for every unlinked game and imports its
 * achievement definitions when a match is found.
 *
 * Split out of `scan:achievements`: RA's rate limits mean this task runs
 * slowly (2s per game), and if the RA credentials are missing or the API
 * errors, isolating it lets the Goldberg-side tasks keep working.
 */
export default defineDropTask({
  buildId: () => `link:retroachievements:${new Date().toISOString()}`,
  name: "Auto-link RetroAchievements",
  acls: ["system:maintenance:read"],
  taskGroup: "link:retroachievements",

  async run({ progress, logger }) {
    const creds = await resolveRACredentials();
    if (!creds) {
      logger.info(
        "No RA credentials available (set RA_USERNAME/RA_API_KEY or link an account). Nothing to do.",
      );
      progress(100);
      return;
    }

    const client = createRAClient(creds.username, creds.apiKey);

    const allGames = await prisma.game.findMany({
      select: {
        id: true,
        mName: true,
        libraryPath: true,
        externalLinks: {
          where: { provider: ExternalAccountProvider.RetroAchievements },
          select: { id: true },
        },
      },
    });

    const unlinked = allGames.filter((g) => g.externalLinks.length === 0);
    logger.info(
      `${unlinked.length} game(s) without RA links (out of ${allGames.length})`,
    );

    let matched = 0;
    let skipped = 0;

    for (let i = 0; i < unlinked.length; i++) {
      const game = unlinked[i];
      const gameName = game.mName ?? game.libraryPath;

      try {
        const results = await client.searchGame(gameName);
        if (results.length === 0) {
          skipped++;
          progress(Math.round(((i + 1) / unlinked.length) * 100));
          continue;
        }

        const match = results[0];
        const info = await client.getGameAchievements(match.ID);
        if (!info) {
          skipped++;
          progress(Math.round(((i + 1) / unlinked.length) * 100));
          continue;
        }

        await prisma.gameExternalLink.create({
          data: {
            gameId: game.id,
            provider: ExternalAccountProvider.RetroAchievements,
            externalGameId: String(match.ID),
          },
        });

        let achCount = 0;
        let order = 0;
        for (const [externalId, achievement] of Object.entries(
          info.Achievements || {},
        )) {
          const iconUrl = achievement.BadgeName
            ? `https://media.retroachievements.org/Badge/${achievement.BadgeName}.png`
            : "";
          const iconLockedUrl = achievement.BadgeName
            ? `https://media.retroachievements.org/Badge/${achievement.BadgeName}_lock.png`
            : "";

          await prisma.achievement.upsert({
            where: {
              gameId_provider_externalId: {
                gameId: game.id,
                provider: ExternalAccountProvider.RetroAchievements,
                externalId,
              },
            },
            create: {
              gameId: game.id,
              provider: ExternalAccountProvider.RetroAchievements,
              externalId,
              title: achievement.Title || externalId,
              description: achievement.Description || "",
              iconUrl,
              iconLockedUrl,
              displayOrder: order,
            },
            update: {
              title: achievement.Title || externalId,
              description: achievement.Description || "",
              iconUrl,
              iconLockedUrl,
              displayOrder: order,
            },
          });

          achCount++;
          order++;
        }

        logger.info(
          `${gameName} → RA: ${match.Title} (${match.ID}), ${achCount} achievements`,
        );
        matched++;
      } catch (e) {
        logger.info(
          `${gameName} — RA search failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        skipped++;
      }

      progress(Math.round(((i + 1) / unlinked.length) * 100));
      // RA has strict rate limits — 2s between games (2 API calls per game).
      await new Promise((r) => setTimeout(r, 2000));
    }

    logger.info(
      `RetroAchievements: ${matched} matched, ${skipped} skipped (out of ${unlinked.length} unlinked)`,
    );
  },
});
