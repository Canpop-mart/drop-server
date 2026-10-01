import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import roomManager from "~/server/internal/zerotier";

/**
 * GET /api/v1/client/room/mine
 *
 * The live room the calling device is in, as host or member, so a client that
 * restarted (or crashed) can offer to rejoin or leave it. 404 when it isn't in
 * one.
 */
export default defineClientEventHandler(async (_h3, { clientId }) => {
  const room = await roomManager.getMyRoom(clientId);
  if (!room)
    throw createError({
      statusCode: 404,
      statusMessage: "Not in a co-op room.",
    });
  return room;
});
