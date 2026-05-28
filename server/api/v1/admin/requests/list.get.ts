import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { VoteType } from "~/prisma/client/enums";
import type { Prisma } from "~/prisma/client/client";

const VALID_STATUSES = ["Pending", "Approved", "Denied", "Withdrawn"] as const;

/**
 * Admin list of game requests with vote breakdowns and requester /
 * reviewer info. Pass `?status=Pending` (etc.) to filter; omit to get
 * everything. The admin triage UI calls this with `?status=Pending` for
 * the action queue and again with no filter for the history view.
 *
 * Vote counts are computed via a single groupBy + the embedded `_count`
 * so this scales fine to a few hundred requests without N+1s.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const status = query.status as string | undefined;

  const where: Prisma.GameRequestWhereInput = {};
  if (status) {
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }
    where.status = status as Prisma.GameRequestWhereInput["status"];
  }

  const requests = await prisma.gameRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { votes: true } },
    },
  });

  // Up-vote counts in one groupBy; down-votes are derived from the
  // total so we don't pay for two queries.
  const requestIds = requests.map((r) => r.id);
  const upVotes = await prisma.requestVote.groupBy({
    by: ["requestId"],
    where: { requestId: { in: requestIds }, vote: VoteType.Up },
    _count: true,
  });
  const upMap = Object.fromEntries(upVotes.map((v) => [v.requestId, v._count]));

  const userIds = [
    ...new Set([
      ...requests.map((r) => r.requesterId),
      ...requests.filter((r) => r.reviewerId).map((r) => r.reviewerId!),
    ]),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      username: true,
      displayName: true,
      profilePictureObjectId: true,
    },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return requests.map((r) => {
    const total = r._count.votes;
    const up = upMap[r.id] ?? 0;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      igdbUrl: r.igdbUrl,
      steamUrl: r.steamUrl,
      status: r.status,
      reviewNotes: r.reviewNotes,
      gameId: r.gameId,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      requester: userMap[r.requesterId] ?? null,
      reviewer: r.reviewerId ? (userMap[r.reviewerId] ?? null) : null,
      votes: { up, down: total - up, total },
    };
  });
});
