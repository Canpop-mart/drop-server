import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import sessionHandler from "~/server/internal/session";
import prisma from "~/server/internal/db/database";
import metadataHandler from "~/server/internal/metadata";
import libraryManager from "~/server/internal/library";
import notificationSystem from "~/server/internal/notifications";
import { GameType, RequestStatus } from "~/prisma/client/enums";

/**
 * Admin approve action for a game request.
 *
 * Two-mode payload:
 *
 *  1. With `library` + `path` — calls `metadataHandler.createGame` (the
 *     same utility the admin import wizard uses), then links the
 *     resulting `gameId` onto the request. This is the proper "full"
 *     approval: the game becomes available in the catalog immediately
 *     and the admin gets a task id back for the import.
 *
 *  2. Without `library`/`path` — marks the request Approved and stores
 *     the chosen metadata in `reviewNotes` for follow-up. Used when the
 *     binary isn't on a shelf yet but the admin wants to commit to
 *     adding it; the admin imports the binary later via the normal
 *     library/import flow and the requester sees "Approved" in the
 *     meantime.
 *
 * In both modes the requester gets a notification, the reviewer is
 * recorded (when the admin is acting via a session — system-token
 * admins leave reviewerId null, matching the schema), and the request's
 * status flips to Approved.
 */
const ApproveBody = type({
  // Metadata is always required — even in defer-import mode we want to
  // remember which game the admin agreed to add, so the eventual import
  // doesn't have to re-search.
  metadata: {
    sourceId: "string",
    id: "string",
    name: "string",
  },
  // Optional: when present, drive a full Game import right now.
  "library?": "string",
  "path?": "string",
  "type?": type.valueOf(GameType),
  "discFolders?": "string[]",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  // Best-effort reviewer id from the session — fine to leave null for
  // system-token callers (the column is nullable in schema).
  const session = await sessionHandler.getSession(h3);
  const reviewerId = session?.authenticated?.userId ?? null;

  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No request ID." });

  const body = await readDropValidatedBody(h3, ApproveBody);

  const existing = await prisma.gameRequest.findUnique({ where: { id } });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });
  if (existing.status === RequestStatus.Approved)
    throw createError({
      statusCode: 400,
      statusMessage: "Request is already approved.",
    });

  // Defer-import mode: stash metadata as JSON on reviewNotes, mark
  // approved, return without touching the Game table. The admin will
  // import the binary later via the regular import wizard, picking the
  // same metadata.
  //
  // Using `updateMany` + count check (not `update`) to satisfy Drop's
  // `drop/no-prisma-delete` lint rule — same write semantics, just
  // without the implicit "row must exist" throw. We already
  // findUnique'd above so we use `existing` for the response payload.
  const fullImport = body.library && body.path;
  if (!fullImport) {
    const reviewNotes = JSON.stringify({
      metadata: body.metadata,
      deferred: true,
    });
    const reviewedAt = new Date();
    const result = await prisma.gameRequest.updateMany({
      where: { id },
      data: {
        status: RequestStatus.Approved,
        reviewNotes,
        reviewerId,
        reviewedAt,
      },
    });
    if (result.count === 0)
      throw createError({
        statusCode: 404,
        statusMessage: "Request not found.",
      });
    const updated = {
      ...existing,
      status: RequestStatus.Approved,
      reviewNotes,
      reviewerId,
      reviewedAt,
    };
    await notifyRequester(updated.requesterId, updated.id, updated.title, null);
    return { request: updated, deferred: true };
  }

  // Full-import mode: same validation as `/api/v1/admin/import/game`.
  const validPath = await libraryManager.checkUnimportedGamePath(
    body.library!,
    body.path!,
  );
  if (!validPath)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid library or game path.",
    });

  const created = await metadataHandler.createGame(
    body.metadata,
    body.library!,
    body.path!,
    body.type ?? GameType.Game,
    body.discFolders,
  );
  if (!created)
    throw createError({
      statusCode: 400,
      statusMessage:
        "Duplicate metadata import — a game already exists for this metadata. " +
        "Pick a different game or unlink the existing one first.",
    });

  const reviewNotes = JSON.stringify({
    metadata: body.metadata,
    taskId: created.taskId,
  });
  const reviewedAt = new Date();
  const result = await prisma.gameRequest.updateMany({
    where: { id },
    data: {
      status: RequestStatus.Approved,
      gameId: created.gameId,
      reviewNotes,
      reviewerId,
      reviewedAt,
    },
  });
  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Request not found.",
    });

  const updated = {
    ...existing,
    status: RequestStatus.Approved,
    gameId: created.gameId,
    reviewNotes,
    reviewerId,
    reviewedAt,
  };

  await notifyRequester(
    updated.requesterId,
    updated.id,
    updated.title,
    created.gameId,
  );

  return {
    request: updated,
    gameId: created.gameId,
    taskId: created.taskId,
    deferred: false,
  };
});

async function notifyRequester(
  requesterId: string,
  requestId: string,
  title: string,
  gameId: string | null,
) {
  // Nonce keyed on the request id so re-approval (shouldn't happen, but
  // belt-and-braces) doesn't duplicate the notification.
  await notificationSystem.push(requesterId, {
    nonce: `request-approved-${requestId}`,
    title: "Game request approved",
    description: `Your request for "${title}" has been approved.`,
    actions: gameId
      ? [`View game|/store/${gameId}`, "View requests|/requests"]
      : ["View requests|/requests"],
    acls: ["user:store:read"],
  });
}
