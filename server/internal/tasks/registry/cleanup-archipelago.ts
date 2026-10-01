import archipelagoManager from "~/server/internal/archipelago";
import { defineDropTask } from "..";

/**
 * Archipelago session upkeep (rules in `reapAction`): closes Setup sessions
 * no member has used through Drop in 30 days (90 once a YAML is uploaded),
 * deletes sessions Closed for 30 days, and de-authorizes overlay members that
 * are no longer in any open session. Running sessions are never touched. Daily.
 */
export default defineDropTask({
  buildId: () => `cleanup:archipelago:${new Date().toISOString()}`,
  name: "Clean Up Archipelago Sessions",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:archipelago",
  async run({ progress, logger }) {
    const { closed, purged, deauthorized } =
      await archipelagoManager.reapStale();
    logger.info(
      `Closed ${closed} stale Archipelago session(s), deleted ${purged} old closed session(s), de-authorized ${deauthorized} overlay member(s)`,
    );
    progress(100);
  },
});
