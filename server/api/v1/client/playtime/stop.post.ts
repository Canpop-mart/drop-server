import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StopBody = type({
  sessionId: "string",
}).configure(throwingArktype);

/**
 * Stop a playtime session.
 * Finalizes the PlaySession record (sets endedAt + durationSeconds)
 * and upserts the cumulative Playtime record for the game/user pair.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const body = await readDropValidatedBody(h3, StopBody);

  const user = await fetchUser();

  const session = await prisma.playSession.findUnique({
    where: { id: body.sessionId },
  });

  if (!session)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });

  if (session.userId !== user.id)
    throw createError({ statusCode: 403, statusMessage: "Not your session." });

  if (session.endedAt)
    throw createError({
      statusCode: 400,
      statusMessage: "Session already ended.",
    });

  const now = new Date();
  const durationSeconds = Math.max(
    Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
    0,
  );

  // Finalize the session
  const updated = await prisma.playSession.updateMany({
    where: { id: session.id, userId: user.id },
    data: {
      endedAt: now,
      durationSeconds,
    },
  });

  if (updated.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });

  // Recompute cumulative playtime by merging overlapping session intervals.
  // This prevents duplicate/concurrent sessions from inflating the total.
  const sessions = await prisma.playSession.findMany({
    where: {
      gameId: session.gameId,
      userId: user.id,
      endedAt: { not: null },
    },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, endedAt: true },
  });

  const totalSeconds = mergeAndSumSessions(sessions);

  await prisma.playtime.upsert({
    where: {
      gameId_userId: {
        gameId: session.gameId,
        userId: user.id,
      },
    },
    create: {
      gameId: session.gameId,
      userId: user.id,
      seconds: totalSeconds,
    },
    update: {
      seconds: totalSeconds,
    },
  });

  return { durationSeconds };
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
