import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { VoteType } from "~/prisma/client/enums";
import { requesterVisibleNote } from "~/server/internal/requests/matching";

/**
 * The signed-in user's own requests, every status, newest first. Backs the
 * "My requests" view of the request board on the web page and in Big
 * Picture. `denyReason` is the admin's note for a denied request; `game` is
 * set once the requested game is in the library.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const requests = await prisma.gameRequest.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      game: { select: { id: true, mName: true } },
      _count: { select: { votes: true } },
    },
  });

  const upVotes = await prisma.requestVote.groupBy({
    by: ["requestId"],
    where: {
      requestId: { in: requests.map((r) => r.id) },
      vote: VoteType.Up,
    },
    _count: true,
  });
  const upMap = Object.fromEntries(upVotes.map((v) => [v.requestId, v._count]));

  return requests.map((r) => {
    const up = upMap[r.id] ?? 0;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      denyReason:
        r.status === "Denied" ? requesterVisibleNote(r.reviewNotes) : null,
      game: r.game ? { id: r.game.id, name: r.game.mName } : null,
      votes: { up, down: r._count.votes - up },
    };
  });
});
