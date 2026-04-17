import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const RemoteInstallBody = type({
  gameId: "string",
  "targetClientId?": "string",
}).configure(throwingArktype);

/**
 * Request a remote install of a game on another device.
 * Creates a "Requested" streaming session with no game streaming intent —
 * the target device's poller will see it and trigger a download instead.
 *
 * For now, this uses the streaming session mechanism with a special status
 * to signal "install, don't stream". The target device polls pending-requests
 * and checks if the game is NOT installed, triggering a download.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, RemoteInstallBody);
  const user = await fetchUser();

  // Verify the game exists
  const game = await prisma.game.findUnique({
    where: { id: body.gameId },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  // If a target client is specified, verify it belongs to this user
  if (body.targetClientId) {
    const target = await prisma.client.findFirst({
      where: { id: body.targetClientId, userId: user.id },
    });
    if (!target)
      throw createError({
        statusCode: 404,
        statusMessage: "Target device not found.",
      });
  }

  // Cancel any existing pending install requests for this game from this client
  await prisma.streamingSession.updateMany({
    where: {
      requestingClientId: clientId,
      gameId: body.gameId,
      status: "Requested",
    },
    data: { status: "Stopped" },
  });

  // Create a session in "Requested" state — the target device's poller
  // will detect the game isn't installed and trigger a download
  const session = await prisma.streamingSession.create({
    data: {
      userId: user.id,
      hostClientId: body.targetClientId ?? clientId,
      requestingClientId: clientId,
      gameId: body.gameId,
      status: "Requested",
    },
  });

  return { sessionId: session.id };
});
