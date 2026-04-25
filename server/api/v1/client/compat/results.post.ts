import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { GameCompatibilityStatus } from "~/prisma/client/enums";

const SIGNATURE_MAX = 200;
const NOTES_MAX = 2000;
const LOG_EXCERPT_MAX = 16 * 1024; // 16KB

const ResultBody = type({
  gameId: "string",
  status: type.valueOf(GameCompatibilityStatus),
  "signature?": "string",
  "protonVersion?": "string",
  "notes?": "string",
  "logExcerpt?": "string",
}).configure(throwingArktype);

/**
 * Records a single compatibility test result for the authenticated client
 * against a game. One row per test run; the latest row per (gameId, clientId)
 * is the current state. Old rows are kept for history, so re-running a test
 * after fixing a bug shows up as a transition rather than overwriting the
 * prior failure.
 *
 * Caller is the test worker (drop-client) or, in Phase A, the bash test rig
 * via curl. The clientId is taken from the JWT auth, not the body — clients
 * can only report results for themselves.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, ResultBody);

  // Verify the game exists — otherwise we'd silently accept results for
  // ghost game IDs and the foreign key would just CASCADE on the next
  // delete, hiding the problem.
  const game = await prisma.game.findUnique({
    where: { id: body.gameId },
    select: { id: true },
  });
  if (!game) {
    throw createError({
      statusCode: 404,
      message: `Game ${body.gameId} not found`,
    });
  }

  const result = await prisma.gameCompatibilityResult.create({
    data: {
      gameId: body.gameId,
      clientId,
      status: body.status,
      ...(body.signature !== undefined && {
        signature: body.signature.slice(0, SIGNATURE_MAX),
      }),
      ...(body.protonVersion !== undefined && {
        protonVersion: body.protonVersion,
      }),
      ...(body.notes !== undefined && {
        notes: body.notes.slice(0, NOTES_MAX),
      }),
      ...(body.logExcerpt !== undefined && {
        logExcerpt: body.logExcerpt.slice(0, LOG_EXCERPT_MAX),
      }),
    },
    select: {
      id: true,
      testedAt: true,
    },
  });

  return result;
});
