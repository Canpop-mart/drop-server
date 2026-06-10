import prisma from "~/server/internal/db/database";
import sessionHandler from "~/server/internal/session";
import { defineDropTask } from "..";

/**
 * Prunes expired auth records in one pass — consolidates the old
 * cleanup:invitations and cleanup:sessions tasks. Deletes expired invitations
 * and clears expired/orphaned login sessions. Bucketed into the daily
 * scheduler; also fired opportunistically when invitations are read/created.
 */
export default defineDropTask({
  buildId: () => `cleanup:auth-records:${new Date().toISOString()}`,
  name: "Prune Expired Records",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:auth-records",
  async run({ progress, logger }) {
    logger.info("Pruning expired auth records");

    const invites = await prisma.invitation.deleteMany({
      where: { expires: { lt: new Date() } },
    });
    logger.info(`Deleted ${invites.count} expired invitation(s)`);
    progress(50);

    await sessionHandler.cleanupSessions();
    logger.info("Cleaned up expired/orphaned sessions");

    logger.info("Done");
    progress(100);
  },
});
