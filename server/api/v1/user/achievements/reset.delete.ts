import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resetsRepo } from "~/server/internal/achievements";

/**
 * Reset (delete) the current user's unlocked achievements, for one game
 * (`?gameId=`) or for every game.
 *
 * Deleting the rows is not enough on its own: the player's emulator save file
 * and RetroAchievements still say those achievements are earned, and the next
 * session would report them all again. So this also writes an
 * AchievementReset marker per affected game; unlocks earned before it are
 * ignored from then on (see server/internal/achievements/reset.ts). For an
 * all-games reset, "affected" means every game the user had an unlock in.
 *
 * Returns `{ deleted, resetAt }`.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["achievements:reset"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getQuery(h3).gameId as string | undefined;
  const resetAt = new Date();

  let gameIds: string[];
  if (gameId) {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true },
    });
    if (!game)
      throw createError({ statusCode: 404, statusMessage: "Game not found." });
    gameIds = [gameId];
  } else {
    const unlocked = await prisma.userAchievement.findMany({
      where: { userId: user.id },
      select: { achievement: { select: { gameId: true } } },
    });
    gameIds = unlocked.map((u) => u.achievement.gameId);
  }

  // Marker first: if the delete below fails, the user retries and nothing
  // was lost, whereas rows deleted without a marker would come straight back.
  await resetsRepo.markReset(user.id, gameIds, resetAt);

  const result = await prisma.userAchievement.deleteMany({
    where: {
      userId: user.id,
      ...(gameId ? { achievement: { gameId } } : {}),
    },
  });

  return { deleted: result.count, resetAt: resetAt.toISOString() };
});
