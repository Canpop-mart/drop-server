import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Close orphaned play sessions for the authenticated user.
 * An orphaned session is one that was started but never stopped
 * (no endedAt) and is older than 1 hour.
 *
 * This is a self-service endpoint so users can fix their own
 * broken sessions without waiting for the 24h auto-close.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["read"]);
  if (!user) throw createError({ statusCode: 403 });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Find orphaned sessions (no endedAt, started more than 1h ago)
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

  // Close each orphan and upsert cumulative playtime
  let closed = 0;
  for (const orphan of orphans) {
    const endedAt = new Date(
      Math.min(
        new Date(orphan.startedAt).getTime() + 24 * 60 * 60 * 1000,
        Date.now(),
      ),
    );
    const durationSeconds = Math.floor(
      (endedAt.getTime() - new Date(orphan.startedAt).getTime()) / 1000,
    );

    await prisma.playSession.update({
      where: { id: orphan.id },
      data: { endedAt, durationSeconds },
    });

    // Upsert cumulative playtime
    await prisma.playtime.upsert({
      where: {
        gameId_userId: {
          gameId: orphan.gameId,
          userId: user.id,
        },
      },
      create: {
        gameId: orphan.gameId,
        userId: user.id,
        seconds: durationSeconds,
      },
      update: {
        seconds: { increment: durationSeconds },
      },
    });

    closed++;
  }

  return { closed };
});
