import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Per-game "firsts" — for every achievement in this game, the user who was
 * first to unlock it on this server.
 *
 * Approach: pull all achievements + all unlocks for the game in two queries,
 * then take the earliest unlock per achievement in JS. Achievements with no
 * unlocks yet are omitted from the response. For the ~50 achievements x ~6
 * users case this stays fast; if a game ever grows hundreds of achievements
 * we'd want to push this into a CTE, but until then the join would be more
 * complex than the data justifies.
 *
 * The system user (and any disabled user) is excluded from "first" credit so
 * test/seed unlocks don't poison the leaderboard.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    select: { id: true, title: true, iconUrl: true },
  });
  if (achievements.length === 0) return [];

  const achievementIds = achievements.map((a) => a.id);

  // All unlocks for these achievements ordered earliest-first; we exclude
  // disabled / system users at the join below.
  const unlocks = await prisma.userAchievement.findMany({
    where: { achievementId: { in: achievementIds } },
    orderBy: { unlockedAt: "asc" },
    select: {
      achievementId: true,
      userId: true,
      unlockedAt: true,
    },
  });

  // We need the user row for displayName + to filter out system/disabled.
  // One findMany over the unique set of unlocker IDs.
  const unlockerIds = [...new Set(unlocks.map((u) => u.userId))];
  const users = unlockerIds.length
    ? await prisma.user.findMany({
        where: {
          id: { in: unlockerIds },
          enabled: true,
          username: { not: "system" },
        },
        select: { id: true, displayName: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Walk unlocks in ascending unlockedAt order; the first valid (eligible
  // user) unlock per achievement wins. Skipping ineligible users here means
  // the second-fastest legitimate user gets credit when the first to unlock
  // was the system seed.
  type First = {
    achievementId: string;
    achievementName: string;
    achievementIconUrl: string;
    userId: string;
    displayName: string;
    unlockedAt: string;
  };
  const firstsByAchievement = new Map<string, First>();
  const achievementMap = new Map(achievements.map((a) => [a.id, a]));

  for (const u of unlocks) {
    if (firstsByAchievement.has(u.achievementId)) continue;
    const user = userMap.get(u.userId);
    if (!user) continue;
    const ach = achievementMap.get(u.achievementId);
    if (!ach) continue;
    firstsByAchievement.set(u.achievementId, {
      achievementId: ach.id,
      achievementName: ach.title,
      achievementIconUrl: ach.iconUrl,
      userId: user.id,
      displayName: user.displayName,
      unlockedAt: u.unlockedAt.toISOString(),
    });
  }

  // Return in the achievement table's own order — gives the UI a stable
  // list matching the achievement page's natural ordering.
  return achievements
    .map((a) => firstsByAchievement.get(a.id))
    .filter((x): x is First => !!x);
});
