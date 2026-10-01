import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import sessionHandler from "~/server/internal/session";
import prisma from "~/server/internal/db/database";
import {
  REQUEST_NOTE_MAX,
  notifyRequestDenied,
} from "~/server/internal/requests";
import { RequestStatus } from "~/prisma/client/enums";

/**
 * Admin deny action for a game request. Only a Pending request can be
 * denied.
 *
 * The optional reason is stored as plain text in `reviewNotes`. The
 * requester sees it in the notification and on the "My requests" view of
 * the request board (`/api/v1/store/requests/list`).
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
  if (existing.status !== RequestStatus.Pending)
    throw createError({
      statusCode: 409,
      statusMessage: `Only pending requests can be denied. This one is ${existing.status.toLowerCase()}.`,
    });

  const reason = body.reason?.trim() ?? "";
  if (reason.length > REQUEST_NOTE_MAX)
    throw createError({
      statusCode: 400,
      statusMessage: `The reason must be ${REQUEST_NOTE_MAX} characters or fewer.`,
    });
  const reviewNotes = reason || null;
  const reviewedAt = new Date();

  // updateMany + count check rather than .update() to satisfy Drop's
  // `drop/no-prisma-delete` lint rule, guarded on Pending so a concurrent
  // approve or withdraw wins cleanly. We already findUnique'd above, so the
  // response payload reuses `existing` with the new fields.
  const result = await prisma.gameRequest.updateMany({
    where: { id, status: RequestStatus.Pending },
    data: {
      status: RequestStatus.Denied,
      reviewNotes,
      reviewerId,
      reviewedAt,
    },
  });
  if (result.count === 0)
    throw createError({
      statusCode: 409,
      statusMessage:
        "The request changed while it was being denied. Reload and try again.",
    });

  const updated = {
    ...existing,
    status: RequestStatus.Denied,
    reviewNotes,
    reviewerId,
    reviewedAt,
  };

  await notifyRequestDenied(
    updated.requesterId,
    updated.id,
    updated.title,
    reason,
  );

  return updated;
});
