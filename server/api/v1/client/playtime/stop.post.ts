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
  const durationSeconds = Math.floor(
    (now.getTime() - session.startedAt.getTime()) / 1000,
  );

  // Finalize the session
  await prisma.playSession.update({
    where: { id: session.id },
    data: {
      endedAt: now,
      durationSeconds,
    },
  });

  // Upsert cumulative playtime for this game/user pair
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
      seconds: durationSeconds,
    },
    update: {
      seconds: { increment: durationSeconds },
    },
  });

  return { durationSeconds };
});
