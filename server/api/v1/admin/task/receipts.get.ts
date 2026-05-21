import { type } from "arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const Query = type({
  "status?": "'success' | 'failed' | 'cancelled' | 'orphaned' | 'in_progress'",
  "taskGroup?": "string",
  "search?": "string",
  "sinceHours?": "number",
  "take?": "number",
});

/**
 * Paginated history of TaskReceipts for the admin history tab.
 * Filterable by status, taskGroup, free-text name, and a "since N hours"
 * window. Returns the most recent first.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:read"]);
  if (!allowed) throw createError({ statusCode: 403 });
  const allAcls = await aclManager.fetchAllACLs(h3);
  if (!allAcls) throw createError({ statusCode: 403 });

  const q = getQuery(h3);
  const parsed = Query({
    status: typeof q.status === "string" ? q.status : undefined,
    taskGroup: typeof q.taskGroup === "string" ? q.taskGroup : undefined,
    search: typeof q.search === "string" ? q.search : undefined,
    sinceHours: q.sinceHours ? Number(q.sinceHours) : undefined,
    take: q.take ? Number(q.take) : undefined,
  });
  if (parsed instanceof type.errors)
    throw createError({ statusCode: 400, statusMessage: parsed.summary });

  const where: Record<string, unknown> = {
    OR: [{ acls: { hasSome: allAcls } }, { acls: { isEmpty: true } }],
  };
  if (parsed.status) where.status = parsed.status;
  if (parsed.taskGroup) where.taskGroup = parsed.taskGroup;
  if (parsed.search)
    where.name = { contains: parsed.search, mode: "insensitive" };
  if (parsed.sinceHours)
    where.startedAt = {
      gt: new Date(Date.now() - parsed.sinceHours * 60 * 60 * 1000),
    };

  const receipts = await prisma.taskReceipt.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: Math.min(parsed.take ?? 50, 200),
    select: {
      id: true,
      taskGroup: true,
      name: true,
      status: true,
      startedAt: true,
      endedAt: true,
      error: true,
      progress: true,
      actions: true,
      retryArgs: true,
    },
  });

  return receipts.map((r) => ({
    ...r,
    // expose whether a one-click retry is feasible. Ad-hoc tasks
    // (game imports etc.) need the original action — see retry endpoint.
    retryable:
      (r.retryArgs as { kind?: string } | null)?.kind === "registered" &&
      r.status !== "success",
  }));
});
