import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const ConnectBody = type({
  sessionId: "string",
}).configure(throwingArktype);

/**
 * Get connection details for a streaming session.
 * Called by a remote client that wants to connect to a host's stream.
 * Returns the Sunshine connection info including pairing PIN if set.
 * Only available to clients owned by the same user as the session.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const body = await readDropValidatedBody(h3, ConnectBody);
  const user = await fetchUser();

  const session = await prisma.streamingSession.findUnique({
    where: { id: body.sessionId },
    include: {
      hostClient: {
        select: {
          id: true,
          name: true,
          platform: true,
        },
      },
      game: {
        select: {
          id: true,
          mName: true,
        },
      },
    },
  });

  if (!session)
    throw createError({
      statusCode: 404,
      statusMessage: "Session not found.",
    });
  if (session.userId !== user.id)
    throw createError({
      statusCode: 403,
      statusMessage: "Not your session.",
    });
  if (session.status === "Stopped")
    throw createError({
      statusCode: 410,
      statusMessage: "Session has ended.",
    });

  return {
    id: session.id,
    status: session.status,
    hostClient: session.hostClient,
    game: session.game,
    sunshinePort: session.sunshinePort,
    hostLocalIp: session.hostLocalIp,
    hostExternalIp: session.hostExternalIp,
    pairingPin: session.pairingPin,
  };
});
