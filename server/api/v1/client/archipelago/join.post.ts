import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";
import { ZT_NODE_ID_RE } from "~/server/internal/zerotier";

const JoinBody = type({
  shortCode: "string",
  zerotierNodeId: "string",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/archipelago/join
 *
 * Join a session by short code: authorize the caller's device onto the shared
 * overlay and give them a slot to upload their YAML into.
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

  const { session, network } = await archipelagoManager.joinSession({
    shortCode: body.shortCode,
    clientId,
    nodeId,
  });

  return {
    sessionId: session.id,
    shortCode: session.shortCode,
    name: session.name,
    networkId: network.networkId,
    serverAddress: network.serverAddress,
  };
});
