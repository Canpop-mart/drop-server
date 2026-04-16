import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StartBody = type({
  gameId: "string | undefined",
  sunshinePort: "number | undefined",
  hostLocalIp: "string | undefined",
  hostExternalIp: "string | undefined",
}).configure(throwingArktype);

/**
 * Register a new streaming session from the host client.
 * The host starts Sunshine and tells the server it's available.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, StartBody);
  const user = await fetchUser();

  // If a game ID was provided, verify it exists
  if (body.gameId) {
    const game = await prisma.game.findUnique({
      where: { id: body.gameId },
    });
    if (!game)
      throw createError({
        statusCode: 404,
        statusMessage: "Game not found.",
      });
  }

  // End any existing active sessions from this client
  await prisma.streamingSession.updateMany({
    where: {
      hostClientId: clientId,
      status: { in: ["Starting", "Ready", "Streaming"] },
    },
    data: { status: "Stopped" },
  });

  const session = await prisma.streamingSession.create({
    data: {
      userId: user.id,
      hostClientId: clientId,
      gameId: body.gameId ?? null,
      sunshinePort: body.sunshinePort ?? 47990,
      hostLocalIp: body.hostLocalIp ?? null,
      hostExternalIp: body.hostExternalIp ?? null,
      status: "Starting",
    },
  });

  return { sessionId: session.id };
});
