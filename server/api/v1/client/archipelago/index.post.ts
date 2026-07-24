import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";
import { ZT_NODE_ID_RE } from "~/server/internal/zerotier";

// `zerotierNodeId` is the host device's own ZeroTier identity, authorized onto
// the shared Archipelago overlay so it can reach the server.
const CreateBody = type({
  zerotierNodeId: "string",
  "name?": "string <= 64",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/archipelago
 *
 * Start an Archipelago session. Ensures the shared overlay network exists (and
 * that the server itself is on it), authorizes the caller's device, and returns
 * the shareable short code.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, CreateBody);

  const nodeId = body.zerotierNodeId.toLowerCase();
  if (!ZT_NODE_ID_RE.test(nodeId))
    throw createError({
      statusCode: 400,
      statusMessage:
        "Invalid zerotierNodeId (expected a 10-character hex ZeroTier node id).",
    });

  const { session, network } = await archipelagoManager.createSession({
    hostClientId: clientId,
    hostNodeId: nodeId,
    name: body.name,
  });

  return {
    sessionId: session.id,
    shortCode: session.shortCode,
    name: session.name,
    networkId: network.networkId,
    serverAddress: network.serverAddress,
  };
});
