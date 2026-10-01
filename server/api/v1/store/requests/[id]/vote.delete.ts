import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus, VoteType } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const requestId = getRouterParam(h3, "id");
  if (!requestId)
    throw createError({ statusCode: 400, statusMessage: "No requestId." });

  // Same rule as casting a vote: once a request is decided its count is
  // frozen, so the board shows what the admin saw. The Pending check is part
  // of the delete itself, with the request row locked FOR SHARE, so a
  // decision cannot slip in between a check and the write (see
  // vote.post.ts).
  const deleted = await prisma.$executeRaw`
    DELETE FROM "RequestVote" v
    WHERE v."requestId" = ${requestId}
      AND v."userId" = ${userId}
      AND EXISTS (
        SELECT 1 FROM "GameRequest" r
        WHERE r."id" = ${requestId} AND r."status" = 'Pending'::"RequestStatus"
        FOR SHARE
      )
  `;
  if (deleted === 0) {
    // Nothing deleted: either there was no vote to clear, which is fine
    // while the request is open, or the request is closed or gone.
    const request = await prisma.gameRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (!request)
      throw createError({
        statusCode: 404,
        statusMessage: "Request not found.",
      });
    if (request.status !== RequestStatus.Pending)
      throw createError({
        statusCode: 409,
        statusMessage: "Voting is closed for this request.",
      });
  }

  const [upCount, downCount] = await Promise.all([
    prisma.requestVote.count({ where: { requestId, vote: VoteType.Up } }),
    prisma.requestVote.count({ where: { requestId, vote: VoteType.Down } }),
  ]);

  return { up: upCount, down: downCount, userVote: null };
});
