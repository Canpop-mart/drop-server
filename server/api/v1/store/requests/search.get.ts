import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { Prisma } from "~/prisma/client/client";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const q = (query.q as string) || "";
  const status = query.status as string | undefined;

  const where: Prisma.GameRequestWhereInput = {};
  if (q) {
    where.title = { contains: q, mode: "insensitive" };
  }
  if (status) {
    where.status = status as Prisma.GameRequestWhereInput["status"];
  }

  const requests = await prisma.gameRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
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
