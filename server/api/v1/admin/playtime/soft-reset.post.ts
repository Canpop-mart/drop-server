import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Soft-reset playtime for a user (or all users).
 *
 * What it does:
 *   - Sets all Playtime.seconds to 0 (the cumulative rollup)
 *   - Closes any open PlaySessions
 *   - Does NOT delete PlaySession records — they're kept as a backup
 *
 * To restore: re-run the "Recalculate Playtime" task, which recomputes
 * Playtime.seconds from the preserved PlaySession records.
 *
 * Query params:
 *   userId — optional, reset only this user. Omit to reset everyone.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const userId = query.userId as string | undefined;

  const where = userId ? { userId } : {};

  // Close any open sessions first
  const now = new Date();
  const closedSessions = await prisma.playSession.updateMany({
    where: { ...where, endedAt: null },
    data: { endedAt: now },
  });

  // Zero out all cumulative playtime records
  const resetPlaytime = await prisma.playtime.updateMany({
    where,
    data: { seconds: 0 },
  });

  return {
    message: userId
      ? `Soft-reset playtime for user ${userId}`
      : "Soft-reset playtime for all users",
    closedOpenSessions: closedSessions.count,
    resetPlaytimeRecords: resetPlaytime.count,
    restoreInstructions:
      "Run the 'Recalculate Playtime' task to restore from session history.",
  };
});
