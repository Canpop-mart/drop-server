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
  const rawSeconds = Math.floor(
    (now.getTime() - session.startedAt.getTime()) / 1000,
  );

  // Cap individual sessions at 24 hours to prevent runaway durations
  const MAX_SESSION_SECONDS = 24 * 60 * 60;
  const durationSeconds = Math.min(Math.max(rawSeconds, 0), MAX_SESSION_SECONDS);

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

  // Recompute cumulative playtime from all finished sessions
  // (avoids drift from incremental accounting)
  const aggregate = await prisma.playSession.aggregate({
    where: {
      gameId: session.gameId,
      userId: user.id,
      endedAt: { not: null },
      durationSeconds: { not: null },
    },
    _sum: { durationSeconds: true },
  });

  const totalSeconds = aggregate._sum.durationSeconds ?? durationSeconds;

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
