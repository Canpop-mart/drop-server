import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { mergeAndSumSessions } from "~/server/internal/playtime/merge-sessions";

const StopBody = type({
  sessionId: "string",
  /** Client-measured process duration — more accurate than server timestamps */
  "clientDurationSecs?": "number",
}).configure(throwingArktype);

/**
 * Stop a playtime session.
 * Finalizes the PlaySession record (sets endedAt + durationSeconds)
 * and upserts the cumulative Playtime record for the game/user pair.
 *
 * When `clientDurationSecs` is provided, the server trusts the client's
 * measured process runtime instead of computing it from timestamps.
 * This is more accurate because:
 *   - The client measures actual process wall-clock time
 *   - Server timestamps drift when the NAS sleeps between start/stop
 *   - Network delays in the stop request inflate server-side duration
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

  // Prefer client-measured duration when available — it's the actual process
  // runtime measured locally. Fall back to server-side timestamp math.
  const serverDuration = Math.max(
    Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
    0,
  );
  const durationSeconds =
    body.clientDurationSecs != null
      ? Math.max(body.clientDurationSecs, 0)
      : serverDuration;

  // Compute endedAt from startedAt + duration (not now()) for consistency
  const endedAt = new Date(
    session.startedAt.getTime() + durationSeconds * 1000,
  );

  // Finalize the session
  const updated = await prisma.playSession.updateMany({
    where: { id: session.id, userId: user.id },
    data: {
      endedAt,
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
