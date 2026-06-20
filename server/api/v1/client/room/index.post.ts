import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager, { ZT_NODE_ID_RE } from "~/server/internal/zerotier";

// `zerotierNodeId` is the host device's own ZeroTier node id (its local
// zerotier-one identity) — the controller authorizes it onto the new network.
const HostBody = type({
  zerotierNodeId: "string",
  "gameId?": "string",
  "name?": "string <= 64",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/room
 *
 * Host a new co-op room: mint a ZeroTier network, authorize the caller's device
 * onto it, and return the shareable short code + network id to join.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, HostBody);

  const nodeId = body.zerotierNodeId.toLowerCase();
  if (!ZT_NODE_ID_RE.test(nodeId))
    throw createError({
      statusCode: 400,
      statusMessage:
        "Invalid zerotierNodeId (expected a 10-character hex ZeroTier node id).",
    });

  return await roomManager.createRoom({
    hostClientId: clientId,
    hostNodeId: nodeId,
    gameId: body.gameId,
    name: body.name,
  });
});
