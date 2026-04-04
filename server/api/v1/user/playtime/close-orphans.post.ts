import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Close orphaned play sessions for the authenticated user.
 * An orphaned session is one that was started but never stopped
 * (no endedAt) and is older than 1 hour.
 *
 * After closing orphans, recomputes cumulative playtime using
 * interval merging to avoid double-counting overlapping sessions.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["read"]);
  if (!user) throw createError({ statusCode: 403 });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const orphans = await prisma.playSession.findMany({
    where: {
      userId: user.id,
      endedAt: null,
      startedAt: { lt: oneHourAgo },
    },
    select: {
      id: true,
      gameId: true,
      startedAt: true,
    },
  });

  if (orphans.length === 0) {
    return { closed: 0 };
  }

  // Close each orphan with its real elapsed time
  const affectedGameIds = new Set<string>();
  const now = Date.now();

  for (const orphan of orphans) {
    const elapsed = Math.floor(
      (now - new Date(orphan.startedAt).getTime()) / 1000,
    );

    await prisma.playSession.updateMany({
      where: { id: orphan.id },
      data: { endedAt: new Date(now), durationSeconds: elapsed },
    });

    affectedGameIds.add(orphan.gameId);
  }

  // Recompute cumulative playtime using interval merging
  for (const gameId of affectedGameIds) {
    const sessions = await prisma.playSession.findMany({
      where: {
        gameId,
        userId: user.id,
        endedAt: { not: null },
      },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, endedAt: true },
    });

    const totalSeconds = mergeAndSumSessions(sessions);

    await prisma.playtime.upsert({
      where: { gameId_userId: { gameId, userId: user.id } },
      create: { gameId, userId: user.id, seconds: totalSeconds },
      update: { seconds: totalSeconds },
    });
  }

  return { closed: orphans.length };
});

/** Merge overlapping time intervals and return total non-overlapping seconds. */
function mergeAndSumSessions(
  sessions: { startedAt: Date; endedAt: Date | null }[],
): number {
  if (sessions.length === 0) return 0;

  let totalSeconds = 0;
  let curStart = sessions[0].startedAt.getTime();
  let curEnd = sessions[0].endedAt?.getTime() ?? curStart;

  for (let i = 1; i < sessions.length; i++) {
    const start = sessions[i].startedAt.getTime();
    const end = sessions[i].endedAt?.getTime() ?? start;

    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      totalSeconds += Math.floor((curEnd - curStart) / 1000);
      curStart = start;
      curEnd = end;
    }
  }

  totalSeconds += Math.floor((curEnd - curStart) / 1000);
  return totalSeconds;
}
