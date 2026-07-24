import { type } from "arktype";
import {
  readDropValidatedBody,
  requireRouterParam,
  throwingArktype,
} from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

const ConnectBody = type({
  connectAddress: "string <= 128",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/archipelago/:id/connect
 *
 * Host records the connect string from the Archipelago room page, which is what
 * every other player then copies. Accepts the room page's "/connect host:port"
 * verbatim or a bare "host:port".
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const sessionId = requireRouterParam(h3, "id");
  const body = await readDropValidatedBody(h3, ConnectBody);

  const session = await archipelagoManager.setConnectAddress({
    sessionId,
    clientId,
    connectAddress: body.connectAddress,
  });

  return { connectAddress: session.connectAddress, status: session.status };
});
