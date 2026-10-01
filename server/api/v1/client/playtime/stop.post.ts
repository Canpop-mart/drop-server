import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import {
  MAX_LATE_REPORT_MS,
  clampSessionDuration,
  recomputeUserGamePlaytime,
} from "~/server/internal/playtime/rollup";

const StopBody = type({
  sessionId: "string",
  /** Client-measured process duration — more accurate than server timestamps */
  "clientDurationSecs?": "number >= 0",
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
 *
 * A session the server already closed still accepts a measured duration.
 * When a stop cannot reach the server the client queues it and replays it on
 * a later start, and by then orphan cleanup may have closed the session with
 * an estimate (last heartbeat plus ten minutes, or five minutes with no
 * heartbeat). The measured length replaces that estimate. A replay of a stop
 * that already landed carries the same duration and changes nothing. With no
 * duration in the body an ended session is still a 400, as before.
 *
 * Bounded so a replay cannot inflate old history: it is only accepted within
 * {@link MAX_LATE_REPORT_MS} of the session's start (later, the same 400 as
 * before). A replay that shortens the server's estimate, or keeps it, is
 * taken as measured. Only the part that would stretch the session past what
 * the server already has is limited: it may not run past the start of the
 * user's next session (any game, any device, since sessions carry no
 * device), and the session never ends up shorter than it already was.
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

  const now = new Date();
  const replay = session.endedAt !== null;
  if (
    replay &&
    (body.clientDurationSecs == null ||
      now.getTime() - session.startedAt.getTime() > MAX_LATE_REPORT_MS)
  )
    throw createError({
      statusCode: 400,
      statusMessage: "Session already ended.",
    });

  // Prefer client-measured duration when available — it's the actual process
  // runtime measured locally. Fall back to server-side timestamp math.
  const serverDuration = Math.max(
    Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
    0,
  );
  let durationSeconds = clampSessionDuration(
    body.clientDurationSecs ?? serverDuration,
    session.startedAt,
    now,
  );
  const already = session.durationSeconds ?? 0;
  if (replay && durationSeconds > already) {
    const next = await prisma.playSession.findFirst({
      where: {
        userId: user.id,
        id: { not: session.id },
        startedAt: { gt: session.startedAt },
      },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });
    if (next) {
      const room = Math.floor(
        (next.startedAt.getTime() - session.startedAt.getTime()) / 1000,
      );
      durationSeconds = Math.max(
        already,
        Math.min(durationSeconds, Math.max(room, 0)),
      );
    }
  }

  // Compute endedAt from startedAt + duration (not now()) for consistency
  const endedAt = new Date(
    session.startedAt.getTime() + durationSeconds * 1000,
  );

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

  await recomputeUserGamePlaytime(session.gameId, user.id);

  return {
    durationSeconds,
    // True when this replaced an estimate the server had already written.
    replacedEstimate: replay,
  };
});
