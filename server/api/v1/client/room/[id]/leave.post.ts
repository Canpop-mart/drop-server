import { requireRouterParam } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager from "~/server/internal/zerotier";

/**
 * POST /api/v1/client/room/:id/leave
 *
 * Leave a room. If the host leaves, the room and its network are torn down for
 * everyone; otherwise the caller is de-authorized and marked as left.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const roomId = requireRouterParam(h3, "id");
  return await roomManager.leaveRoom({ roomId, clientId });
});
