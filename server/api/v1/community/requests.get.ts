import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Community view: show approved + pending requests from all users
  const requests = await prisma.gameRequest.findMany({
    where: {
      status: { in: [RequestStatus.Pending, RequestStatus.Approved] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const userIds = [...new Set(requests.map((r) => r.requesterId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true, profilePictureObjectId: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return requests.map((r) => ({
    ...r,
    requester: userMap[r.requesterId] ?? null,
  }));
});
