import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { systemConfig } from "~/server/internal/config/sys-conf";
import { getSupportedGames } from "~/server/internal/archipelago/webhost";

/**
 * GET /api/v1/client/archipelago/config
 *
 * WebHost integration config for the client's Archipelago screen: the
 * browser-openable WebHost URL (if the operator configured one) and the games it
 * supports, so the client can deep-link to a game's options (YAML generator)
 * page. Both are empty/null when no WebHost is configured.
 *
 * A static route, so it takes precedence over the `[id]` session lookup.
 */
export default defineClientEventHandler(async () => {
  const webHostUrl = systemConfig.getArchipelagoWebHostUrl() ?? null;
  const games = webHostUrl ? await getSupportedGames() : [];
  return { webHostUrl, games };
});
