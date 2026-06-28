import { type } from "arktype";
import {
  readDropValidatedBody,
  requireRouterParam,
  throwingArktype,
} from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager from "~/server/internal/zerotier";

// A ZeroTier-assigned IPv4 (e.g. 10.242.7.153). The host is authed and only
// reports its own address, so a loose length cap is enough.
const AddressBody = type({
  address: "string <= 45",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/room/:id/address
 *
 * The host self-reports its assigned ZeroTier IP for this room. ZeroTier assigns
 * the address asynchronously after the host joins, so it isn't known at
 * room-create time; joiners read it back from GET /room/:id to connect by IP.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const roomId = requireRouterParam(h3, "id");
  const body = await readDropValidatedBody(h3, AddressBody);
  return await roomManager.setHostAddress({
    roomId,
    clientId,
    address: body.address,
  });
});
