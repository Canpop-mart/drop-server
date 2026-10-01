import { defineDropTask } from "..";
import {
  closeOrphanSessions,
  recomputePlaytimeTotals,
} from "./recalculate-playtime";

/**
 * The daily, unattended half of "Recalculate Playtime": close sessions that
 * were never stopped, then recompute every cumulative total from the
 * sessions.
 *
 * Before this, orphaned sessions were only closed when somebody opened a
 * profile's stats (the five most recent sessions) or an admin ran the full
 * recalculation by hand, so a crashed game's session could sit open, and its
 * playtime missing from the total, indefinitely.
 *
 * Phase 0 of the full task is deliberately left out: it caps long sessions to
 * their heartbeat window, which would cut a real long session whose
 * heartbeats were lost even though the client reported its measured length.
 * Both steps here only change rows that are still out of line, so running
 * this every day is safe.
 */
export default defineDropTask({
  buildId: () => `cleanup:playtime-sessions:${new Date().toISOString()}`,
  name: "Close Abandoned Play Sessions",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:playtime-sessions",

  async run({ progress, logger }) {
    await closeOrphanSessions(logger);
    progress(20);
    await recomputePlaytimeTotals(logger, (f) =>
      progress(20 + Math.round(f * 80)),
    );
  },
});
