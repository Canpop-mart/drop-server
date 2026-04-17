import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const AcceptBody = type({
  sessionId: "string",
  "sunshinePort?": "number",
  "hostLocalIp?": "string",
  "pairingPin?": "string",
}).configure(throwingArktype);

/**
 * Accept a pending stream request.
 * The host client takes ownership of the session, updates its details,
 * and transitions it to "Starting" (then "Ready" after Sunshine is up).
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, AcceptBody);
  const user = await fetchUser();

  // Atomically update only if the session exists, belongs to this user, and is Requested
  const result = await prisma.streamingSession.updateMany({
    where: {
      id: body.sessionId,
      userId: user.id,
      status: "Requested",
    },
    data: {
      hostClientId: clientId,
      status: "Starting",
      sunshinePort: body.sunshinePort ?? 47989,
      hostLocalIp: body.hostLocalIp ?? null,
      pairingPin: body.pairingPin ?? null,
      lastHeartbeat: new Date(),
    },
  });

  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found or not in Requested state.",
    });

  return { sessionId: body.sessionId, status: "Starting" };
});
