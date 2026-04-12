import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const status = query.status as string | undefined;

  const validStatuses = ["Open", "InProgress", "Resolved", "Closed"];
  const where: Record<string, unknown> = {};
  if (status && validStatuses.includes(status)) {
    where.status = status;
  }

  const reports = await prisma.bugReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  // Batch-fetch related users
  const userIds = [
    ...new Set([
      ...reports.map((r) => r.reporterId),
      ...reports.filter((r) => r.assigneeId).map((r) => r.assigneeId!),
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

  return reports.map((r) => ({
    ...r,
    reporter: userMap[r.reporterId] ?? null,
    assignee: r.assigneeId ? (userMap[r.assigneeId] ?? null) : null,
  }));
});
