import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { Prisma } from "~/prisma/client/client";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const status = query.status as string | undefined;

  const where: Prisma.GameRequestWhereInput = {};
  if (status) where.status = status as Prisma.GameRequestWhereInput["status"];

  const requests = await prisma.gameRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

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

  return requests.map((r) => ({
    ...r,
    requester: userMap[r.requesterId] ?? null,
    reviewer: r.reviewerId ? (userMap[r.reviewerId] ?? null) : null,
  }));
});
