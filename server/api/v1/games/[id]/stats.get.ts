import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Returns per-game stats for the authenticated user:
 * - playtimeSeconds: total seconds played
 * - lastPlayedAt: most recent session end (or start if still active)
 * - cloudSaveCount: number of cloud save slots
 * - achievementsUnlocked: number of achievements the user has unlocked
 * - achievementsTotal: total number of (deduplicated) achievements for this game
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "Missing game ID." });

  const [playtime, lastSession, saveCount, achievementData, userUnlocks] =
    await Promise.all([
      prisma.playtime.findUnique({
        where: { gameId_userId: { gameId, userId } },
        select: { seconds: true },
      }),

      prisma.playSession.findFirst({
        where: { gameId, userId },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, endedAt: true },
      }),

      prisma.saveSlot.count({
        where: { gameId, userId },
      }),

      prisma.achievement.findMany({
        where: { gameId },
        select: { id: true, externalId: true },
      }),

      prisma.userAchievement.findMany({
        where: {
          userId,
          achievement: { gameId },
        },
        select: { achievementId: true },
      }),
    ]);

  // Deduplicate achievements by externalId (same logic as achievements.get.ts)
  const uniqueExternalIds = new Set(achievementData.map((a) => a.externalId));
  const achievementsTotal = uniqueExternalIds.size;

  // Count unlocked: a unique achievement is unlocked if ANY of its provider IDs is unlocked
  const unlockedAchIds = new Set(userUnlocks.map((u) => u.achievementId));
  const externalIdToUnlocked = new Map<string, boolean>();
  for (const a of achievementData) {
    if (unlockedAchIds.has(a.id)) {
      externalIdToUnlocked.set(a.externalId, true);
    }
  }
  const achievementsUnlocked = externalIdToUnlocked.size;

  return {
    playtimeSeconds: playtime?.seconds ?? 0,
    lastPlayedAt: lastSession?.endedAt ?? lastSession?.startedAt ?? null,
    cloudSaveCount: saveCount,
    achievementsUnlocked,
    achievementsTotal,
  };
});
