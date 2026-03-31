import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { RequestStatus } from "~/prisma/client/enums";

const UpdateRequest = type({
  status: "'Approved' | 'Denied' | 'Pending'",
  reviewNotes: "string | undefined",
  gameId: "string | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No request ID." });

  const body = await readDropValidatedBody(h3, UpdateRequest);

  const existing = await prisma.gameRequest.findUnique({ where: { id } });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });

  const updated = (
    await prisma.gameRequest.updateManyAndReturn({
      where: { id },
      data: {
        status: body.status as RequestStatus,
        reviewNotes: body.reviewNotes,
        reviewerId: userId,
        reviewedAt: new Date(),
        ...(body.gameId && { gameId: body.gameId }),
      },
    })
  ).at(0);

  if (!updated)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });

  return updated;
});
