import prisma from "~/server/internal/db/database";
import notificationSystem from "~/server/internal/notifications";
import { logger } from "~/server/internal/logging";
import { RequestStatus } from "~/prisma/client/enums";
import type { ImportedGameRef } from "./matching";
import { matchRequestsForImportedGame } from "./matching";

/**
 * Where request notifications send the requester: the "My requests" view of
 * the request board (pages/requests.vue reads `?view=mine`).
 */
export const MY_REQUESTS_ACTION = "My requests|/requests?view=mine";

export const REQUEST_TITLE_MAX = 120;
export const REQUEST_DESCRIPTION_MAX = 500;
export const REQUEST_NOTE_MAX = 500;
export const REQUEST_URL_MAX = 500;

/**
 * Body of the 409 that create.post.ts returns for a refused request, under
 * the error's `data`. The request pages use it to offer a vote on the
 * existing request (or a link to the game) instead.
 */
export type CreateRequestConflict = {
  reason: "duplicate" | "similar" | "in-library";
  request?: {
    id: string;
    title: string;
    status: string;
    mine: boolean;
    /**
     * The provider name of the game the existing request points at, when it
     * has one. Its title is free text and may not name the game at all, so
     * the pages show this next to it.
     */
    matchedName: string | null;
  };
  game?: { id: string; name: string };
};

/** Columns the matching helpers need, for `select`. */
export const requestRefSelect = {
  id: true,
  title: true,
  status: true,
  gameId: true,
  steamUrl: true,
  reviewNotes: true,
  metadataSource: true,
  metadataId: true,
  metadataName: true,
} as const;

export async function notifyRequestApproved(
  requesterId: string,
  requestId: string,
  title: string,
  gameId: string | null,
) {
  await notificationSystem.push(requesterId, {
    nonce: `request-approved-${requestId}`,
    title: "Game request approved",
    description: gameId
      ? `Your request for "${title}" was approved and the game is in the library.`
      : `Your request for "${title}" was approved. You will get another notice when it is added.`,
    actions: gameId
      ? [`View game|/store/${gameId}`, MY_REQUESTS_ACTION]
      : [MY_REQUESTS_ACTION],
    acls: ["user:store:read"],
  });
}

export async function notifyRequestDenied(
  requesterId: string,
  requestId: string,
  title: string,
  reason: string,
) {
  await notificationSystem.push(requesterId, {
    nonce: `request-denied-${requestId}`,
    title: "Game request denied",
    description: reason
      ? `Your request for "${title}" was denied: ${reason}`
      : `Your request for "${title}" was denied.`,
    actions: [MY_REQUESTS_ACTION],
    acls: ["user:store:read"],
  });
}

export async function notifyRequestFulfilled(
  requesterId: string,
  requestId: string,
  title: string,
  gameId: string,
) {
  await notificationSystem.push(requesterId, {
    nonce: `request-fulfilled-${requestId}`,
    title: "Requested game added",
    description: `"${title}" is now in the library.`,
    actions: [`View game|/store/${gameId}`, MY_REQUESTS_ACTION],
    acls: ["user:store:read"],
  });
}

/**
 * Puts an Approved request that has no game back to Pending, keeping the
 * admin's pick in the metadata columns so it is preselected when the admin
 * approves again. Used when the import started by an approval cannot start
 * or fails, and by the admin's "Move back to pending" action.
 *
 * `onlyIfReviewedAt` limits it to the approval that started the import, so
 * a later approval (with its own import) is never undone by an old one's
 * failure.
 *
 * The requester's "approved" notification is removed, since it promised a
 * second notice that is no longer coming; approving again sends a fresh
 * one. Returns whether the request was moved.
 */
export async function reopenApprovedRequest(
  requestId: string,
  onlyIfReviewedAt?: Date,
): Promise<boolean> {
  const request = await prisma.gameRequest.findUnique({
    where: { id: requestId },
    select: { requesterId: true },
  });
  if (!request) return false;
  const { count } = await prisma.gameRequest.updateMany({
    where: {
      id: requestId,
      status: RequestStatus.Approved,
      gameId: null,
      ...(onlyIfReviewedAt ? { reviewedAt: onlyIfReviewedAt } : {}),
    },
    data: {
      status: RequestStatus.Pending,
      reviewerId: null,
      reviewedAt: null,
    },
  });
  if (count === 0) return false;
  try {
    await prisma.notification.deleteMany({
      where: {
        userId: request.requesterId,
        nonce: `request-approved-${requestId}`,
      },
    });
  } catch (e) {
    // The request is pending again either way; a stale "approved" notice
    // is the only cost.
    logger.warn(
      `[requests] request ${requestId} is pending again but its approved notification could not be removed: ${e}`,
    );
  }
  return true;
}

/**
 * Called by the game import task once the Game row exists. Links every open
 * request the game satisfies (see `matchRequestsForImportedGame`), marks a
 * pending one Approved, and notifies each requester.
 *
 * Returns the number of requests linked. Throws on database failure; the
 * caller logs it and carries on, because a request bookkeeping problem must
 * never fail an import that has already written the game.
 */
export async function fulfilRequestsForImportedGame(
  gameId: string,
  game: ImportedGameRef,
): Promise<number> {
  const candidates = await prisma.gameRequest.findMany({
    where: {
      gameId: null,
      status: { in: [RequestStatus.Pending, RequestStatus.Approved] },
    },
    select: { ...requestRefSelect, requesterId: true },
  });
  const matchedIds = new Set(matchRequestsForImportedGame(game, candidates));
  if (matchedIds.size === 0) return 0;

  let linked = 0;
  const now = new Date();
  for (const req of candidates) {
    if (!matchedIds.has(req.id)) continue;
    // Guarded on the state we matched against, so a request an admin denied
    // or another import linked in the meantime is left alone.
    const wasPending = req.status === RequestStatus.Pending;
    const { count } = await prisma.gameRequest.updateMany({
      where: { id: req.id, gameId: null, status: req.status },
      data: wasPending
        ? { gameId, status: RequestStatus.Approved, reviewedAt: now }
        : { gameId },
    });
    if (count === 0) continue;
    linked++;
    logger.info(
      `[requests] linked request ${req.id} ("${req.title}") to imported game ${gameId}${wasPending ? " and marked it approved" : ""}`,
    );
    try {
      await notifyRequestFulfilled(req.requesterId, req.id, req.title, gameId);
    } catch (e) {
      logger.warn(
        `[requests] linked request ${req.id} but could not notify the requester: ${e}`,
      );
    }
  }
  return linked;
}
