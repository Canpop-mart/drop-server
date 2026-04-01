import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus, VoteType } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const sort = (query.sort as string) === "votes" ? "votes" : "newest";

  // Community view: show approved + pending requests from all users
  const requests = await prisma.gameRequest.findMany({
    where: {
      status: { in: [RequestStatus.Pending, RequestStatus.Approved] },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: {
        select: { votes: true },
      },
    },
  });

  // Batch-fetch vote breakdowns and current user votes
  const requestIds = requests.map((r) => r.id);

  const [upVotes, userVotes] = await Promise.all([
    prisma.requestVote.groupBy({
      by: ["requestId"],
      where: { requestId: { in: requestIds }, vote: VoteType.Up },
      _count: true,
    }),
    prisma.requestVote.findMany({
      where: { requestId: { in: requestIds }, userId },
      select: { requestId: true, vote: true },
    }),
  ]);

  const upMap = Object.fromEntries(upVotes.map((v) => [v.requestId, v._count]));
  const userVoteMap = Object.fromEntries(
    userVotes.map((v) => [v.requestId, v.vote]),
  );

  // Fetch requesters
  const userIds = [...new Set(requests.map((r) => r.requesterId))];
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

  const enriched = requests.map((r) => {
    const totalVotes = r._count.votes;
    const upCount = upMap[r.id] ?? 0;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      igdbUrl: r.igdbUrl,
      steamUrl: r.steamUrl,
      status: r.status,
      createdAt: r.createdAt,
      requester: userMap[r.requesterId] ?? null,
      votes: {
        up: upCount,
        down: totalVotes - upCount,
        total: totalVotes,
        userVote: userVoteMap[r.id] ?? null,
      },
    };
  });

  if (sort === "votes") {
    enriched.sort((a, b) => b.votes.up - a.votes.up);
  }

  return enriched;
});
