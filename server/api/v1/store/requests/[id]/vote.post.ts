import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { VoteType } from "~/prisma/client/enums";

const VoteBody = type({
  vote: "'Up' | 'Down'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const requestId = getRouterParam(h3, "id");
  if (!requestId)
    throw createError({ statusCode: 400, statusMessage: "No requestId." });

  const body = await readDropValidatedBody(h3, VoteBody);

  // One statement, with the Pending check inside the write: the vote is
  // only inserted (or changed) if the request is Pending at that moment.
  // FOR SHARE locks the request row for the statement's transaction, so an
  // approve, deny or withdraw (an UPDATE of that row) either finishes first,
  // and this then sees the new status and writes nothing, or waits until
  // the vote is in. A separate read followed by an upsert could let a vote
  // land on a request that was decided in between.
  const vote = body.vote as VoteType;
  const written = await prisma.$executeRaw`
    INSERT INTO "RequestVote" ("requestId", "userId", "vote")
    SELECT r."id", ${userId}, ${vote}::"VoteType"
    FROM "GameRequest" r
    WHERE r."id" = ${requestId} AND r."status" = 'Pending'::"RequestStatus"
    FOR SHARE
    ON CONFLICT ("requestId", "userId") DO UPDATE SET "vote" = EXCLUDED."vote"
  `;
  if (written === 0) {
    const request = await prisma.gameRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (!request)
      throw createError({
        statusCode: 404,
        statusMessage: "Request not found.",
      });
    throw createError({
      statusCode: 409,
      statusMessage: "Voting is closed for this request.",
    });
  }

  // Return updated vote counts
  const [upCount, downCount] = await Promise.all([
    prisma.requestVote.count({
      where: { requestId, vote: VoteType.Up },
    }),
    prisma.requestVote.count({
      where: { requestId, vote: VoteType.Down },
    }),
  ]);

  return { up: upCount, down: downCount, userVote: body.vote };
});
