import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateBugReport = type({
  status: "'Open' | 'InProgress' | 'Resolved' | 'Closed' | undefined",
  adminNotes: "string | undefined",
  assigneeId: "string | null | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readDropValidatedBody(h3, UpdateBugReport);

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes;
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId;

  // Set resolvedAt when transitioning to Resolved
  if (body.status === "Resolved" || body.status === "Closed") {
    data.resolvedAt = new Date();
  }

  const updated = (
    await prisma.bugReport.updateManyAndReturn({
      where: { id },
      data,
    })
  ).at(0);

  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: "Bug report not found",
    });
  }

  return updated;
});
