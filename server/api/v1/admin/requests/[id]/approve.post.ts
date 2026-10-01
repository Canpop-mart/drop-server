import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import sessionHandler from "~/server/internal/session";
import prisma from "~/server/internal/db/database";
import metadataHandler from "~/server/internal/metadata";
import libraryManager from "~/server/internal/library";
import { GameType, MetadataSource, RequestStatus } from "~/prisma/client/enums";
import {
  REQUEST_TITLE_MAX,
  notifyRequestApproved,
  reopenApprovedRequest,
} from "~/server/internal/requests";
import { logger } from "~/server/internal/logging";

/**
 * Admin approve action for a game request. A Pending request can be
 * approved, and so can an Approved one that has no game yet, so the admin
 * can re-run an import that never finished (the server stopped mid-import,
 * say) or change the pick.
 *
 * The admin says which game the request is for in one of two ways:
 *  - `metadata`: a provider search result ({ sourceId, id, name }).
 *  - `manualTitle`: a plain title, for when the providers have nothing or
 *    could not be reached. Stored as metadataSource = Manual.
 * The choice is written to the request's metadataSource / metadataId /
 * metadataName columns.
 *
 * Then one of two modes:
 *  1. With `library` + `path`: marks the request Approved with the admin's
 *     choice, then starts an import through `metadataHandler.createGame`
 *     (the same call the import wizard uses). The request is NOT linked
 *     here: createGame returns before the Game row exists (the row is
 *     written inside the import task), and GameRequest.gameId is a foreign
 *     key. The import task links it once the row is written
 *     (`fulfilRequestsForImportedGame` in server/internal/requests), by
 *     provider id, or by exact title for a manual approval, which is why
 *     the admin's choice is written before the import starts. If the import
 *     cannot be started, or the import task fails before writing the game,
 *     the request goes back to Pending with the admin's pick kept
 *     (`reopenApprovedRequest`), so the admin can approve it again.
 *  2. Without them: marks the request Approved and leaves the game to be
 *     imported later. If the chosen game is already in the library it is
 *     linked straight away. Otherwise a later import links it, the same way
 *     as in mode 1.
 *
 * In both modes the requester is notified and the reviewer is recorded when
 * the admin acts through a session (system-token callers leave it null).
 */
const ApproveBody = type({
  "metadata?": {
    sourceId: "string",
    id: "string",
    name: "string",
  },
  "manualTitle?": "string",
  // Optional: when present, run a full Game import right now.
  "library?": "string",
  "path?": "string",
  "type?": type.valueOf(GameType),
  "discFolders?": "string[]",
}).configure(throwingArktype);

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message });
}

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  // Best-effort reviewer id from the session; fine to leave null for
  // system-token callers (the column is nullable in schema).
  const session = await sessionHandler.getSession(h3);
  const reviewerId = session?.authenticated?.userId ?? null;

  const id = getRouterParam(h3, "id");
  if (!id) badRequest("No request ID.");

  const body = await readDropValidatedBody(h3, ApproveBody);

  // Which game the request is for.
  let choice: { source: MetadataSource; id: string; name: string };
  if (body.metadata) {
    const source = body.metadata.sourceId as MetadataSource;
    if (!Object.values(MetadataSource).includes(source))
      badRequest(`Unknown metadata provider "${body.metadata.sourceId}".`);
    choice = {
      source,
      id: body.metadata.id,
      name: body.metadata.name.trim(),
    };
  } else {
    const manualTitle = body.manualTitle?.trim() ?? "";
    if (!manualTitle)
      badRequest("Pick a search result or enter a title to approve.");
    if (manualTitle.length > REQUEST_TITLE_MAX)
      badRequest(`Title must be ${REQUEST_TITLE_MAX} characters or fewer.`);
    choice = { source: MetadataSource.Manual, id: "", name: manualTitle };
  }
  const metadataColumns = {
    metadataSource: choice.source,
    metadataId: choice.id || null,
    metadataName: choice.name,
  };

  const existing = await prisma.gameRequest.findUnique({ where: { id } });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Request not found." });
  const reapproval =
    existing.status === RequestStatus.Approved && existing.gameId === null;
  if (existing.status !== RequestStatus.Pending && !reapproval)
    throw createError({
      statusCode: 409,
      statusMessage: existing.gameId
        ? "This request is already linked to a game."
        : `Only pending requests, or approved ones with no game yet, can be approved. This one is ${existing.status.toLowerCase()}.`,
    });

  const fullImport = !!(body.library && body.path);
  let gameId: string | null = null;

  if (fullImport) {
    // Importing needs the import permission too, same as
    // `/api/v1/admin/import/game`.
    const canImport = await aclManager.allowSystemACL(h3, ["import:game:new"]);
    if (!canImport) throw createError({ statusCode: 403 });

    // Same validation as `/api/v1/admin/import/game`.
    const validPath = await libraryManager.checkUnimportedGamePath(
      body.library!,
      body.path!,
    );
    if (!validPath) badRequest("Invalid library or game path.");
  }

  if (choice.id) {
    // Already imported? Link it now rather than waiting for an import that
    // will never happen. In full-import mode this is the same check
    // createGame makes, done first so nothing is written for a refusal.
    const inLibrary = await prisma.game.findUnique({
      where: {
        metadataKey: { metadataSource: choice.source, metadataId: choice.id },
      },
      select: { id: true },
    });
    if (inLibrary && fullImport)
      badRequest(
        "This game is already in the library. Approve without importing to link the request to it.",
      );
    gameId = inLibrary?.id ?? null;
  }

  // Guarded on the exact state read above (status, no game, and the last
  // review time), so a concurrent deny, withdraw, link or second approval
  // wins cleanly and this one gets a 409. updateMany + count rather than
  // .update() to satisfy Drop's `drop/no-prisma-delete` lint rule. gameId is
  // only ever set here to a Game row that was just read back, never to one
  // an import has yet to write.
  const reviewedAt = new Date();
  const data = {
    status: RequestStatus.Approved,
    ...metadataColumns,
    // reviewNotes is the note shown to the requester; an approval has none.
    reviewNotes: null,
    reviewerId,
    reviewedAt,
    ...(gameId ? { gameId } : {}),
  };
  const result = await prisma.gameRequest.updateMany({
    where: {
      id,
      status: existing.status,
      gameId: null,
      reviewedAt: existing.reviewedAt,
    },
    data,
  });
  if (result.count === 0)
    throw createError({
      statusCode: 409,
      statusMessage:
        "The request changed while it was being approved. Reload and try again.",
    });

  let taskId: string | undefined;
  if (fullImport) {
    let started: { taskId: string; gameId: string } | undefined;
    let failure: string;
    try {
      started = await metadataHandler.createGame(
        { sourceId: choice.source, id: choice.id, name: choice.name },
        body.library!,
        body.path!,
        body.type ?? GameType.Game,
        body.discFolders,
        undefined,
        undefined,
        // The import failed inside its task. Unless it got as far as
        // writing the game (then its own request hook has dealt with the
        // request), put the request back to Pending so the admin can try
        // again.
        async (error, importGameId) => {
          const written = await prisma.game.findUnique({
            where: { id: importGameId },
            select: { id: true },
          });
          if (written) return;
          if (await reopenApprovedRequest(id, reviewedAt))
            logger.info(
              `[requests] import for request ${id} failed, so it is pending again: ${error instanceof Error ? error.message : String(error)}`,
            );
        },
      );
      failure =
        "This game is already in the library. Approve without importing to link the request to it.";
    } catch (e) {
      // e.g. an import of the same folder is already running.
      failure = `Could not start the import: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!started) {
      // Back to Pending with the admin's pick kept, unless something else
      // has already moved it on (an import linked it, or it was withdrawn).
      const reopened = await reopenApprovedRequest(id, reviewedAt);
      throw createError({
        statusCode: 400,
        statusMessage: reopened
          ? `${failure} The request is pending again.`
          : failure,
      });
    }
    taskId = started.taskId;
  }

  const updated = { ...existing, ...data, gameId: gameId ?? existing.gameId };
  // The import task sends its own "added to the library" notice when it
  // links the request; this one says it was approved and, without a game
  // yet, that the second notice is coming. A fast import may already have
  // linked the request (its notice is the better one) or failed and moved
  // it back to Pending (then "approved" would be false), so with an import
  // running, only notify while the request is still approved and unlinked.
  let notify = true;
  if (fullImport) {
    const now = await prisma.gameRequest.findUnique({
      where: { id },
      select: { status: true, gameId: true },
    });
    notify = now?.status === RequestStatus.Approved && now.gameId === null;
  }
  if (notify)
    await notifyRequestApproved(
      updated.requesterId,
      updated.id,
      updated.title,
      gameId,
    );

  return {
    request: updated,
    gameId,
    taskId,
    // True when the request is approved but not yet linked to a game; the
    // import (started now or run later) links it.
    deferred: gameId === null,
  };
});
