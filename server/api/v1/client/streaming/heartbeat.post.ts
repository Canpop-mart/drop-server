import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const HeartbeatBody = type({
  sessionId: "string",
  status: "'Starting' | 'Ready' | 'Streaming' | undefined",
}).configure(throwingArktype);

/**
 * Heartbeat for an active streaming session.
 * The host client sends this periodically so the server knows the session
 * is still alive. Optionally updates the status (e.g. Ready → Streaming).
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, HeartbeatBody);

  const data: Record<string, unknown> = {
    lastHeartbeat: new Date(),
  };
  if (body.status) {
    data.status = body.status;
  }

  const result = await prisma.streamingSession.updateMany({
    where: { id: body.sessionId, hostClientId: clientId },
    data,
  });
  if (result.count === 0)
    throw createError({ statusCode: 404, statusMessage: "Session not found." });

  return { ok: true };
});
