import { requireRouterParam } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

/**
 * GET /api/v1/client/archipelago/:id
 *
 * Session state: slots, per-slot YAML readiness, and the connect details. Caller
 * must be in the session.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const sessionId = requireRouterParam(h3, "id");
  return await archipelagoManager.getSession(sessionId, clientId);
});
