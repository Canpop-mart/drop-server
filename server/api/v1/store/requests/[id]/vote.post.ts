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

  // Ensure the request exists and is pending
  const request = await prisma.gameRequest.findUnique({
    where: { id: requestId },
  });
  if (!request)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });

  await prisma.requestVote.upsert({
    where: { requestId_userId: { requestId, userId } },
    create: { requestId, userId, vote: body.vote as VoteType },
    update: { vote: body.vote as VoteType },
  });

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
