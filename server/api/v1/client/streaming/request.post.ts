import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const RequestBody = type({
  gameId: "string",
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

  // Create a new session in "Requested" state
  // hostClientId is set to the requester for now — the accepting host will update it
  const session = await prisma.streamingSession.create({
    data: {
      userId: user.id,
      hostClientId: clientId,
      requestingClientId: clientId,
      gameId: body.gameId,
      status: "Requested",
    },
  });

  return { sessionId: session.id };
});
