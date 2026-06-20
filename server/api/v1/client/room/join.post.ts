import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager, { ZT_NODE_ID_RE } from "~/server/internal/zerotier";

const JoinBody = type({
  shortCode: "string <= 16",
  zerotierNodeId: "string",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/room/join
 *
 * Join an existing room by its short code: authorize the caller's device onto
 * the room's network and return the network id to join locally.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, JoinBody);

  const nodeId = body.zerotierNodeId.toLowerCase();
  if (!ZT_NODE_ID_RE.test(nodeId))
    throw createError({
      statusCode: 400,
      statusMessage:
        "Invalid zerotierNodeId (expected a 10-character hex ZeroTier node id).",
    });

  return await roomManager.joinRoom({
    shortCode: body.shortCode,
    clientId,
    nodeId,
  });
});
