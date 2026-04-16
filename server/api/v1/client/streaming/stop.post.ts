import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StopBody = type({
  sessionId: "string",
}).configure(throwingArktype);

/**
 * Stop a streaming session. Called by the host when Sunshine is shut down
 * or the stream ends.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, StopBody);
  const user = await fetchUser();

  const result = await prisma.streamingSession.updateMany({
    where: { id: body.sessionId, hostClientId: clientId, userId: user.id },
    data: { status: "Stopped" },
  });
  if (result.count === 0)
    throw createError({ statusCode: 404, statusMessage: "Session not found." });

  return { ok: true };
});
