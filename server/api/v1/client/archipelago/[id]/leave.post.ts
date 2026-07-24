import { requireRouterParam } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

/**
 * POST /api/v1/client/archipelago/:id/leave
 *
 * Leave a session. The host leaving closes it for everyone, mirroring co-op
 * rooms where the host ending it dissolves the room.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const sessionId = requireRouterParam(h3, "id");
  await archipelagoManager.leaveSession({ sessionId, clientId });
  return { left: true };
});
