import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const StartBody = type({
  gameId: "string",
}).configure(throwingArktype);

/**
 * Start a playtime session for a game.
 * Creates a PlaySession record and returns its ID.
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const body = await readDropValidatedBody(h3, StartBody);

  const user = await fetchUser();

  // Verify the game exists
  const game = await prisma.game.findUnique({
    where: { id: body.gameId },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  const session = await prisma.playSession.create({
    data: {
      gameId: body.gameId,
      userId: user.id,
      startedAt: new Date(),
    },
  });

  return { sessionId: session.id };
});
