import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const RequestBody = type({
  gameId: "string",
  "targetClientId?": "string",
}).configure(throwingArktype);

/**
 * Request a stream from another client.
 * The requesting client (e.g. Steam Deck) creates a session with status "Requested".
 * A host client (e.g. PC) will poll for these and auto-accept.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const body = await readDropValidatedBody(h3, RequestBody);
  const user = await fetchUser();

  // Verify the game exists
  const game = await prisma.game.findUnique({
    where: { id: body.gameId },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  // Cancel any existing pending requests from this client for this game
  await prisma.streamingSession.updateMany({
    where: {
      requestingClientId: clientId,
      gameId: body.gameId,
      status: "Requested",
    },
    data: { status: "Stopped" },
  });

  // If targeting a specific device, verify it belongs to this user
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

  // Create a new session in "Requested" state
  // If a target is specified, hostClientId is set to that device so only it picks up the request.
  // Otherwise, hostClientId is set to the requester as a placeholder — any host can accept.
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
