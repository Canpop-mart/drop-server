import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

/**
 * GET /api/v1/client/archipelago
 *
 * The caller's open sessions, newest first — so a client that restarts can
 * offer to rejoin rather than making the user hunt for the code.
 */
export default defineClientEventHandler(async (_h3, { clientId }) => {
  return await archipelagoManager.listForClient(clientId);
});
