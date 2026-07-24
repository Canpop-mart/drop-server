import { requireRouterParam } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

/**
 * GET /api/v1/client/archipelago/:id/bundle
 *
 * Every valid slot's YAML as one multi-document file, ready to upload to the
 * Archipelago WebHost's Generate page. Caller must be in the session.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const sessionId = requireRouterParam(h3, "id");

  // Membership check (throws 403/404 for non-members).
  await archipelagoManager.getSession(sessionId, clientId);

  const { filename, body } = await archipelagoManager.buildBundle(sessionId);

  setHeader(h3, "Content-Type", "application/x-yaml; charset=utf-8");
  setHeader(h3, "Content-Disposition", `attachment; filename="${filename}"`);
  return body;
});
