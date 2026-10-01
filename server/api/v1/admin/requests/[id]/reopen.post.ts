import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus } from "~/prisma/client/enums";
import { reopenApprovedRequest } from "~/server/internal/requests";

/**
 * Admin action: move an Approved request that has no game yet back to
 * Pending, keeping the admin's pick. For an approval whose import never
 * finished (the server stopped mid-import) or that should be reconsidered;
 * from Pending the admin can approve it again or deny it.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No request ID." });

  const existing = await prisma.gameRequest.findUnique({
    where: { id },
    select: { status: true, gameId: true },
  });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });
  if (existing.status !== RequestStatus.Approved || existing.gameId !== null)
    throw createError({
      statusCode: 409,
      statusMessage:
        "Only an approved request with no game yet can be moved back to pending.",
    });

  if (!(await reopenApprovedRequest(id)))
    throw createError({
      statusCode: 409,
      statusMessage:
        "The request changed while it was being moved. Reload and try again.",
    });

  return { ok: true };
});
