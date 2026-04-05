import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { mergeAndSumSessions } from "~/server/internal/playtime/merge-sessions";

/**
 * Close orphaned play sessions for the authenticated user.
 * An orphaned session is one that was started but never stopped
 * (no endedAt) and is older than 1 hour.
 *
 * If a heartbeat was received, uses that as the end time for better
 * accuracy. Otherwise falls back to the current time.
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
      lastHeartbeatAt: true,
    },
  });

  if (orphans.length === 0) {
    return { closed: 0 };
  }

  // Close each orphan — prefer lastHeartbeatAt for accurate end time
  const affectedGameIds = new Set<string>();

  for (const orphan of orphans) {
    const endedAt = orphan.lastHeartbeatAt ?? new Date();
    const elapsed = Math.floor(
      (endedAt.getTime() - new Date(orphan.startedAt).getTime()) / 1000,
    );

    await prisma.playSession.updateMany({
      where: { id: orphan.id },
      data: { endedAt, durationSeconds: elapsed },
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
