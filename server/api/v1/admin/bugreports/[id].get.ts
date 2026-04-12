import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const report = await prisma.bugReport.findUnique({
    where: { id },
  });

  if (!report) {
    throw createError({ statusCode: 404, statusMessage: "Bug report not found" });
  }

  // Fetch reporter and assignee
  const userIds = [report.reporterId, report.assigneeId].filter(Boolean) as string[];
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

  return {
    ...report,
    reporter: userMap[report.reporterId] ?? null,
    assignee: report.assigneeId ? (userMap[report.assigneeId] ?? null) : null,
  };
});
