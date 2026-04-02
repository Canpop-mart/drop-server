import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Reset (delete) all achievements for the current user.
 * Optionally accepts a `gameId` query param to reset only one game's achievements.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["user:store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getQuery(h3).gameId as string | undefined;

  // Build the where clause: always scoped to this user
  const where: { userId: string; achievement?: { gameId: string } } = {
    userId: user.id,
  };
  if (gameId) {
    where.achievement = { gameId };
  }

  const result = await prisma.userAchievement.deleteMany({ where });

  return { deleted: result.count };
});
