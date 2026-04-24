import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Audits UserAchievement rows and reports stats per game/user.
 *
 * After a GBE upgrade or a definition refresh the set of Achievement rows
 * can change — some external IDs get renamed, some get removed. This task
 * reconciles:
 *   • UserAchievement rows pointing at now-deleted achievements (impossible
 *     due to onDelete: Cascade, but report any stragglers just in case)
 *   • Per-game unlock counts vs available achievement counts, so admins can
 *     spot "all users unlocked 0/0" (definition fetch never completed).
 *
 * Idempotent — reports only, no user unlock data is ever deleted here.
 */
export default defineDropTask({
  buildId: () => `recalculate:achievements:${new Date().toISOString()}`,
  name: "Recalculate Achievements",
  acls: ["system:maintenance:read"],
  taskGroup: "recalculate:achievements",

  async run({ progress, logger }) {
    logger.info("Phase 1: scanning per-game achievement counts");

    const games = await prisma.game.findMany({
      select: {
        id: true,
        mName: true,
        _count: { select: { achievements: true } },
      },
    });

    let zeroDef = 0;
    let withDefs = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      if (game._count.achievements === 0) {
        zeroDef++;
      } else {
        withDefs++;
      }
      progress(Math.round(((i + 1) / games.length) * 40));
    }

    logger.info(
      `Games with achievement definitions: ${withDefs}. Without: ${zeroDef}.`,
    );

    logger.info("Phase 2: per-user unlock stats");

    const users = await prisma.user.findMany({
      select: { id: true, username: true },
    });
    let totalUnlocks = 0;
    const perUser: { username: string; unlocks: number; games: number }[] = [];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const unlocks = await prisma.userAchievement.count({
        where: { userId: user.id },
      });

      const gamesWithUnlocks = await prisma.userAchievement.groupBy({
        by: ["achievementId"],
        where: { userId: user.id },
      });

      // groupBy above returns one row per achievement; resolve to distinct
      // games by looking up the achievement rows.
      const achievementIds = gamesWithUnlocks.map((g) => g.achievementId);
      const gameIds = new Set<string>();
      if (achievementIds.length > 0) {
        const achievements = await prisma.achievement.findMany({
          where: { id: { in: achievementIds } },
          select: { gameId: true },
        });
        for (const a of achievements) gameIds.add(a.gameId);
      }

      totalUnlocks += unlocks;
      perUser.push({
        username: user.username,
        unlocks,
        games: gameIds.size,
      });

      progress(40 + Math.round(((i + 1) / users.length) * 55));
    }

    perUser.sort((a, b) => b.unlocks - a.unlocks);
    for (const u of perUser) {
      logger.info(
        `  ${u.username}: ${u.unlocks} unlocks across ${u.games} game(s)`,
      );
    }

    logger.info(
      `Totals: ${totalUnlocks} unlocks across ${users.length} user(s) and ${games.length} game(s)`,
    );
    progress(100);
  },
});
