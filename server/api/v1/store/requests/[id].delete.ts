import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No request ID." });

  const request = await prisma.gameRequest.findUnique({ where: { id } });
  if (!request)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });
  if (request.requesterId !== userId) throw createError({ statusCode: 403 });

  // Can only withdraw pending requests
  if (request.status !== RequestStatus.Pending) {
    throw createError({
      statusCode: 400,
      statusMessage: "Can only withdraw pending requests.",
    });
  }

  const updated = (
    await prisma.gameRequest.updateManyAndReturn({
      where: { id },
      data: { status: RequestStatus.Withdrawn },
    })
  ).at(0);

  if (!updated)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });

  return updated;
});
