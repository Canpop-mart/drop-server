import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

interface BugReportRow {
  id: string;
  title: string;
  description: string;
  systemInfo: unknown;
  screenshotObjectId: string | null;
  logs: string | null;
  status: string;
  adminNotes: string | null;
  reporterId: string;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

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

  const reports: BugReportRow[] = await prisma.bugReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  // Batch-fetch related users
  const userIds = [
    ...new Set([
      ...reports.map((r: BugReportRow) => r.reporterId),
      ...reports
        .filter((r: BugReportRow) => r.assigneeId)
        .map((r: BugReportRow) => r.assigneeId!),
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

  return reports.map((r: BugReportRow) => ({
    ...r,
    reporter: userMap[r.reporterId] ?? null,
    assignee: r.assigneeId ? (userMap[r.assigneeId] ?? null) : null,
  }));
});
