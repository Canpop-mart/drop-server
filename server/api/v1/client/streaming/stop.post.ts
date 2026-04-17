import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StopBody = type({
  sessionId: "string",
}).configure(throwingArktype);

/**
 * Stop a streaming session. Can be called by:
 * - The host (hostClientId matches) when Sunshine is shut down
 * - The requester (requestingClientId matches) to cancel a pending request
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, StopBody);
  const user = await fetchUser();

  // Try to stop as host first
  let result = await prisma.streamingSession.updateMany({
    where: { id: body.sessionId, hostClientId: clientId, userId: user.id },
    data: { status: "Stopped" },
  });

  // If not the host, try to stop as the requester (cancel pending request)
  if (result.count === 0) {
    result = await prisma.streamingSession.updateMany({
      where: {
        id: body.sessionId,
        requestingClientId: clientId,
        userId: user.id,
      },
      data: { status: "Stopped" },
    });
  }

  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });

  return { ok: true };
});
