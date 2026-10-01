/**
 * Achievement resets that stick.
 *
 * Deleting a user's UserAchievement rows is only half a reset. The unlocks
 * still exist outside the server: in the emulator save file on the player's
 * machine (which the client re-reads and re-reports every launch) and on
 * RetroAchievements (which ra-poll and session-end re-read). Without a
 * marker, every reset was undone by the next session.
 *
 * So a reset also writes an `AchievementReset { userId, gameId, resetAt }`
 * row, and `unlocksRepo.recordUnlock` refuses any unlock whose earned time is
 * before `resetAt`. An unlock earned after the reset is recorded normally.
 *
 * Limits, stated plainly:
 *   - The guard is only as good as the earned time. A client report with no
 *     usable timestamp is recorded as "earned now" by achievements-report,
 *     which is after the reset, so it gets through. The desktop client
 *     clears its local Goldberg save file on reset for exactly this reason.
 *   - RetroAchievements keeps its own unlocks. After a reset they stay
 *     ignored until the player resets them on retroachievements.org too and
 *     earns them again.
 */
import prisma from "~/server/internal/db/database";

/**
 * True when an unlock earned at `occurredAt` predates the user's reset and
 * must be ignored. No reset marker means nothing is ignored.
 *
 * Pure. drop-server has no test runner, so this is exported and untested.
 */
export function isBeforeReset(occurredAt: Date, resetAt: Date | null): boolean {
  if (!resetAt) return false;
  const t = occurredAt.getTime();
  if (Number.isNaN(t)) return false;
  return t < resetAt.getTime();
}

export const resetsRepo = {
  /** The user's reset time for one game, or null when they never reset it. */
  async getResetAt(userId: string, gameId: string): Promise<Date | null> {
    const row = await prisma.achievementReset.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { resetAt: true },
    });
    return row?.resetAt ?? null;
  },

  /**
   * Record a reset for each game at `at`. Re-resetting a game moves its
   * marker forward. Returns the number of markers written.
   */
  async markReset(
    userId: string,
    gameIds: string[],
    at: Date,
  ): Promise<number> {
    const unique = [...new Set(gameIds)];
    for (const gameId of unique) {
      await prisma.achievementReset.upsert({
        where: { userId_gameId: { userId, gameId } },
        create: { userId, gameId, resetAt: at },
        update: { resetAt: at },
      });
    }
    return unique.length;
  },
};
