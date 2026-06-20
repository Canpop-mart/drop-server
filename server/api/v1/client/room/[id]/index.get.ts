import { requireRouterParam } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager from "~/server/internal/zerotier";

/**
 * GET /api/v1/client/room/:id
 *
 * Fetch a room's current state (members + status). Caller must be the host or
 * a member of the room.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const roomId = requireRouterParam(h3, "id");
  return await roomManager.getRoom(roomId, clientId);
});
