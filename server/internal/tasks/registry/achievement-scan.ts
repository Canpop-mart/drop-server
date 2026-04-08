import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  readGoldbergAppId,
  readGoldbergDefinitions,
  resolveGameVersionDir,
  setupGoldberg,
} from "../../goldberg";
import { createRAClient, resolveRACredentials } from "../../retroachievements";
import fs from "fs";
import path from "path";

/**
 * Unified achievement scan task.
 *
 * Runs three phases in a single pass over all games:
 *   1. Goldberg readiness check — verifies files & DB records, auto-fixes gaps
 *   2. Achievement definition refresh — re-fetches from Steam API if needed
 *   3. RetroAchievements auto-link — searches RA for unlinked games, imports defs
 */
export default defineDropTask({
  buildId: () => `scan:achievements:${new Date().toISOString()}`,
  name: "Scan All Achievements",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:achievements",

  async run({ progress, logger }) {
    // ── Phase 1: Goldberg readiness ──────────────────────────────────────
    logger.info("── Phase 1: Goldberg readiness check ──");

    const goldbergGames = await prisma.game.findMany({
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

    let gbHealthy = 0;
    let gbFixed = 0;
    let gbIssues = 0;

    for (let i = 0; i < goldbergGames.length; i++) {
      const game = goldbergGames[i];
      const appId =
        game.externalLinks[0]?.externalGameId ??
        (game.metadataSource === "Steam" ? game.metadataId : null);

      if (!appId) {
        logger.info(`${game.mName} — no AppID, skipping`);
        progress(Math.round(((i + 1) / goldbergGames.length) * 30));
        continue;
      }

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        logger.info(`${game.mName} — no version directory, skipping`);
        progress(Math.round(((i + 1) / goldbergGames.length) * 30));
        continue;
      }

      const hasAppIdFile = !!readGoldbergAppId(versionDir);
      const localDefs = readGoldbergDefinitions(versionDir);
      const hasAchievementsFile = localDefs.length > 0;
      const hasDbRecords = game._count.achievements > 0;
      const steamSettingsDir = path.join(versionDir, "steam_settings");
      const hasSteamSettings = fs.existsSync(steamSettingsDir);

      const allGood =
        hasAppIdFile && hasAchievementsFile && hasDbRecords && hasSteamSettings;

      if (allGood) {
        gbHealthy++;
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
          gbFixed++;
        } catch (e) {
          logger.info(`${game.mName} — setup failed: ${e}`);
          gbIssues++;
        }
      }

      progress(Math.round(((i + 1) / goldbergGames.length) * 30));
      await new Promise((r) => setTimeout(r, 200));
    }

    logger.info(
      `Goldberg: ${gbHealthy} healthy, ${gbFixed} fixed, ${gbIssues} issue(s) across ${goldbergGames.length} game(s)`,
    );

    // ── Phase 2: Refresh Goldberg definitions ────────────────────────────
    logger.info("── Phase 2: Refresh achievement definitions ──");

    let refreshed = 0;
    let refreshFailed = 0;

    for (let i = 0; i < goldbergGames.length; i++) {
      const game = goldbergGames[i];
      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) continue;

      try {
        await setupGoldberg(game.id, versionDir, {
          forceRefreshAchievements: true,
        });
        refreshed++;
      } catch {
        refreshFailed++;
      }

      progress(30 + Math.round(((i + 1) / goldbergGames.length) * 30));
      await new Promise((r) => setTimeout(r, 500));
    }

    logger.info(`Definitions: ${refreshed} refreshed, ${refreshFailed} failed`);

    // ── Phase 3: RetroAchievements auto-link ─────────────────────────────
    logger.info("── Phase 3: RetroAchievements auto-link ──");

    const raCreds = await resolveRACredentials();
    if (!raCreds) {
      logger.info(
        "No RA credentials available (set RA_USERNAME/RA_API_KEY or link an account). Skipping RA phase.",
      );
      progress(100);
      return;
    }

    const raClient = createRAClient(raCreds.username, raCreds.apiKey);

    // Find games that don't have a RA link yet
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

    const unlinkedGames = allGames.filter((g) => g.externalLinks.length === 0);

    let raMatched = 0;
    let raSkipped = 0;

    for (let i = 0; i < unlinkedGames.length; i++) {
      const game = unlinkedGames[i];
      const gameName = game.mName ?? game.libraryPath;

      try {
        const searchResults = await raClient.searchGame(gameName);

        if (searchResults.length === 0) {
          raSkipped++;
          progress(60 + Math.round(((i + 1) / unlinkedGames.length) * 38));
          continue;
        }

        const match = searchResults[0];
        const gameInfo = await raClient.getGameAchievements(match.ID);
        if (!gameInfo) {
          raSkipped++;
          progress(60 + Math.round(((i + 1) / unlinkedGames.length) * 38));
          continue;
        }

        // Create the external link
        await prisma.gameExternalLink.create({
          data: {
            gameId: game.id,
            provider: ExternalAccountProvider.RetroAchievements,
            externalGameId: String(match.ID),
          },
        });

        // Import achievement definitions
        let achCount = 0;
        let order = 0;
        for (const [externalId, achievement] of Object.entries(
          gameInfo.Achievements || {},
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
        raMatched++;
      } catch (e) {
        logger.info(
          `${gameName} — RA search failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        raSkipped++;
      }

      progress(60 + Math.round(((i + 1) / unlinkedGames.length) * 38));
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info(
      `RetroAchievements: ${raMatched} matched, ${raSkipped} skipped out of ${unlinkedGames.length} unlinked game(s)`,
    );
    progress(100);
  },
});
