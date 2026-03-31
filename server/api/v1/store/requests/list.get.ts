import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const requests = await prisma.gameRequest.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
  });

  // Fetch requester info separately (no include)
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

  return requests.map((r) => ({
    ...r,
    requester: userMap[r.requesterId] ?? null,
  }));
});
