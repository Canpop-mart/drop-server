import roomManager from "~/server/internal/zerotier";
import { defineDropTask } from "..";

/**
 * Tears down co-op rooms past their TTL (deletes the ZeroTier network on the
 * controller, then the DB row). Rooms were otherwise only reaped when someone
 * hosted, browsed or pressed "Reap expired" in the admin page, so an idle
 * server kept dead networks on its controller indefinitely. Daily.
 */
export default defineDropTask({
  buildId: () => `cleanup:rooms:${new Date().toISOString()}`,
  name: "Reap Expired Co-op Rooms",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:rooms",
  async run({ progress, logger }) {
    const reaped = await roomManager.reapExpired();
    logger.info(`Reaped ${reaped} expired co-op room(s)`);
    progress(100);
  },
});
