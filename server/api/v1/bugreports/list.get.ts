import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Users can only see their own bug reports
  const reports = await prisma.bugReport.findMany({
    where: { reporterId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      adminNotes: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
  });

  return reports;
});
