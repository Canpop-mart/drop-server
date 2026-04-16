import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const ReadyBody = type({
  sessionId: "string",
  "pairingPin?": "string",
}).configure(throwingArktype);

/**
 * Mark a streaming session as ready to accept connections.
 * Called by the host once Sunshine is fully started and listening.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, ReadyBody);
  const user = await fetchUser();

  const result = await prisma.streamingSession.updateMany({
    where: { id: body.sessionId, hostClientId: clientId, userId: user.id },
    data: {
      status: "Ready",
      pairingPin: body.pairingPin ?? null,
      lastHeartbeat: new Date(),
    },
  });
  if (result.count === 0)
    throw createError({ statusCode: 404, statusMessage: "Session not found." });

  return { ok: true };
});
