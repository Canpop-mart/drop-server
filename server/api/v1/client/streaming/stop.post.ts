import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StopBody = type({
  sessionId: "string",
  // Why the host gave up, in words for the person who pressed Play. Optional:
  // clients that predate it send the session id alone and must keep working,
  // and a stop the user asked for has no reason to attach.
  "error?": "string <= 500",
}).configure(throwingArktype);

/**
 * Stop a streaming session. Can be called by:
 * - The host (hostClientId matches) when Sunshine is shut down
 * - The requester (requestingClientId matches) to cancel a pending request
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, StopBody);
  const user = await fetchUser();

  // Only write `error` when one was sent, so a later plain stop can't blank a
  // reason the host already recorded.
  const reason = body.error?.trim();
  const data = reason
    ? { status: "Stopped" as const, error: reason }
    : { status: "Stopped" as const };

  // Try to stop as host first
  let result = await prisma.streamingSession.updateMany({
    where: { id: body.sessionId, hostClientId: clientId, userId: user.id },
    data,
  });

  // If not the host, try to stop as the requester (cancel pending request)
  if (result.count === 0) {
    result = await prisma.streamingSession.updateMany({
      where: {
        id: body.sessionId,
        requestingClientId: clientId,
        userId: user.id,
      },
      data,
    });
  }

  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });

  return { ok: true };
});
