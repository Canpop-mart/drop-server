import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const HeartbeatBody = type({
  sessionId: "string",
}).configure(throwingArktype);

/**
 * Heartbeat for an active playtime session.
 *
 * The client sends this every ~5 minutes while a game is running.
 * It updates `lastHeartbeatAt` on the PlaySession so that if the
 * client crashes without sending a stop, orphan cleanup can cap the
 * session at the last heartbeat instead of assuming it ran for hours.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const body = await readDropValidatedBody(h3, HeartbeatBody);
  const user = await fetchUser();

  const session = await prisma.playSession.findUnique({
    where: { id: body.sessionId },
    select: { userId: true, endedAt: true },
  });

  if (!session)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });

  if (session.userId !== user.id)
    throw createError({ statusCode: 403, statusMessage: "Not your session." });

  // Session already ended — nothing to do (not an error)
  if (session.endedAt) return { ok: true };

  await prisma.playSession.updateMany({
    where: { id: body.sessionId, userId: user.id },
    data: { lastHeartbeatAt: new Date() },
  });

  return { ok: true };
});
