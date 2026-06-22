import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager from "~/server/internal/zerotier";

/**
 * GET /api/v1/client/room/browse
 *
 * List currently-joinable co-op rooms so a client can join one without the host
 * having to share a code first.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  return await roomManager.browseRooms(clientId);
});
