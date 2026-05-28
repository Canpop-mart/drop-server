import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import sessionHandler from "~/server/internal/session";
import prisma from "~/server/internal/db/database";
import notificationSystem from "~/server/internal/notifications";
import { RequestStatus } from "~/prisma/client/enums";

/**
 * Admin deny action for a game request.
 *
 * The optional reason is stored as plain text in `reviewNotes` so the
 * requester can see *why* their request was turned down. The approve
 * endpoint stores JSON in the same column (metadata payload); the
 * client distinguishes by status — Denied requests render the string
 * directly, Approved requests parse JSON. Keeping both in one column
 * avoided a migration.
 */
const DenyBody = type({
  "reason?": "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const session = await sessionHandler.getSession(h3);
  const reviewerId = session?.authenticated?.userId ?? null;

  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No request ID." });

  const body = await readDropValidatedBody(h3, DenyBody);

  const existing = await prisma.gameRequest.findUnique({ where: { id } });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });
  if (existing.status === RequestStatus.Denied)
    throw createError({
      statusCode: 400,
      statusMessage: "Request is already denied.",
    });

  const reason = body.reason?.trim() ?? "";

  const updated = await prisma.gameRequest.update({
    where: { id },
    data: {
      status: RequestStatus.Denied,
      reviewNotes: reason || null,
      reviewerId,
      reviewedAt: new Date(),
    },
  });

  await notificationSystem.push(updated.requesterId, {
    nonce: `request-denied-${updated.id}`,
    title: "Game request denied",
    description: reason
      ? `Your request for "${updated.title}" was denied: ${reason}`
      : `Your request for "${updated.title}" was denied.`,
    actions: ["View requests|/requests"],
    acls: ["user:store:read"],
  });

  return updated;
});
