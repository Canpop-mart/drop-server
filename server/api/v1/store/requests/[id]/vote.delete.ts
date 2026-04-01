import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { VoteType } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const requestId = getRouterParam(h3, "id");
  if (!requestId)
    throw createError({ statusCode: 400, statusMessage: "No requestId." });

  await prisma.requestVote.deleteMany({
    where: { requestId, userId },
  });

  const [upCount, downCount] = await Promise.all([
    prisma.requestVote.count({ where: { requestId, vote: VoteType.Up } }),
    prisma.requestVote.count({ where: { requestId, vote: VoteType.Down } }),
  ]);

  return { up: upCount, down: downCount, userVote: null };
});
