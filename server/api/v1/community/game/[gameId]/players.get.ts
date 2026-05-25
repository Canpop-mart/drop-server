import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Per-game player list — used by the per-game community tab and the
 * "Friends · X of 6" tile. Returns every user with non-zero playtime OR
 * non-zero achievement unlocks for this game, sorted by playtime desc.
 *
 * Aggregates done with groupBy + count instead of joining via the user
 * graph so we keep this to 4 indexed queries regardless of player count.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Total achievements defined for this game (denominator for the chip).
  // Done up front so empty-achievement games still get a sensible 0/0.
  const achievementsTotal = await prisma.achievement.count({
    where: { gameId },
  });

  // Per-user playtime for this game (uses Playtime rollup — already indexed
  // by gameId in the @@id, see prisma/models/content.prisma).
  const playtimeRows = await prisma.playtime.findMany({
    where: { gameId },
    select: { userId: true, seconds: true },
  });

  // Achievement IDs for this game, then per-user unlock counts.
  const achievementRows = await prisma.achievement.findMany({
    where: { gameId },
    select: { id: true },
  });
  const achievementIds = achievementRows.map((a) => a.id);

  const unlockGroups =
    achievementIds.length > 0
      ? await prisma.userAchievement.groupBy({
          by: ["userId"],
          where: { achievementId: { in: achievementIds } },
          _count: true,
        })
      : [];

  const playtimeByUser = new Map(
    playtimeRows.map((p) => [p.userId, p.seconds]),
  );
  const unlocksByUser = new Map(unlockGroups.map((g) => [g.userId, g._count]));

  // Union of users who have either signal for this game.
  const candidateIds = new Set<string>([
    ...playtimeByUser.keys(),
    ...unlocksByUser.keys(),
  ]);
  if (candidateIds.size === 0) return [];

  // Resolve to user rows (filter system + disabled here, not above, so the
  // aggregate queries can use the cheap indexed filter).
  const users = await prisma.user.findMany({
    where: {
      id: { in: [...candidateIds] },
      enabled: true,
      username: { not: "system" },
    },
    select: {
      id: true,
      displayName: true,
      profilePictureObjectId: true,
    },
  });

  const result = users
    .map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      avatarObjectId: u.profilePictureObjectId || null,
      playtimeSeconds: playtimeByUser.get(u.id) ?? 0,
      achievementsUnlocked: unlocksByUser.get(u.id) ?? 0,
      achievementsTotal,
    }))
    // True non-players (both signals zero) — drop them. They show up via
    // the union above only if someone else's filter brought them in.
    .filter((p) => p.playtimeSeconds > 0 || p.achievementsUnlocked > 0)
    .sort(
      (a, b) =>
        b.playtimeSeconds - a.playtimeSeconds ||
        b.achievementsUnlocked - a.achievementsUnlocked,
    );

  return result;
});
