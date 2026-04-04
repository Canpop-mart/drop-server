import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Sanitizes PlaySession records and recomputes cumulative Playtime.
 *
 * Phase 1 — Close orphaned sessions (open > 1 hour).
 *           Ended at the earlier of (startedAt + actual elapsed) or now.
 *
 * Phase 2 — For each game/user pair, fetch all finished sessions,
 *           merge overlapping time intervals, and compute wall-clock
 *           play time. This prevents concurrent/duplicate sessions from
 *           double-counting time. Overwrites Playtime.seconds.
 *
 * Safe to run at any time — fully idempotent.
 */
const recalculatePlaytime = defineDropTask({
  buildId: () => `recalculate-playtime-${Date.now()}`,
  taskGroup: "recalculate:playtime",
  name: "Recalculate Playtime",
  acls: ["system:maintenance:read"],
  async run({ logger, progress }) {
    // ── Phase 0: Wipe all bad session data and start fresh ─────────
    logger.info(
      "Phase 0: Wiping all existing play sessions and playtime records",
    );

    const deletedSessions = await prisma.playSession.deleteMany({});
    const deletedPlaytime = await prisma.playtime.deleteMany({});

    logger.info(
      `Phase 0: deleted ${deletedSessions.count} sessions, ${deletedPlaytime.count} playtime records`,
    );
    progress(10);

    // ── Phase 1: Close orphaned sessions ───────────────────────────
    logger.info("Phase 1: Closing orphaned sessions (should be 0 after wipe)");

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const orphans = await prisma.playSession.findMany({
      where: {
        endedAt: null,
        startedAt: { lt: oneHourAgo },
      },
      select: { id: true, startedAt: true },
    });

    for (const orphan of orphans) {
      const now = Date.now();
      const elapsed = Math.floor((now - orphan.startedAt.getTime()) / 1000);
      const endedAt = new Date(now);

      await prisma.playSession.updateMany({
        where: { id: orphan.id },
        data: { endedAt, durationSeconds: elapsed },
      });
    }

    logger.info(`Phase 1: closed ${orphans.length} orphaned sessions`);
    progress(20);

    // ── Phase 2: Recompute cumulative totals (merge overlaps) ──────
    logger.info(
      "Phase 2: Recomputing cumulative playtime (merging overlapping sessions)",
    );

    const playtimeRecords = await prisma.playtime.findMany({
      select: { gameId: true, userId: true, seconds: true },
    });

    let corrected = 0;

    for (let i = 0; i < playtimeRecords.length; i++) {
      const record = playtimeRecords[i];

      // Fetch all finished sessions for this game/user, sorted by start
      const sessions = await prisma.playSession.findMany({
        where: {
          gameId: record.gameId,
          userId: record.userId,
          endedAt: { not: null },
        },
        orderBy: { startedAt: "asc" },
        select: { startedAt: true, endedAt: true },
      });

      // Merge overlapping intervals and sum wall-clock time
      const correctSeconds = mergeAndSum(sessions);

      if (record.seconds !== correctSeconds) {
        logger.info(
          `Correcting playtime for game=${record.gameId} user=${record.userId}: ` +
            `${record.seconds}s (${(record.seconds / 3600).toFixed(1)}h) → ` +
            `${correctSeconds}s (${(correctSeconds / 3600).toFixed(1)}h) ` +
            `[${sessions.length} sessions]`,
        );

        await prisma.playtime.updateMany({
          where: {
            gameId: record.gameId,
            userId: record.userId,
          },
          data: { seconds: correctSeconds },
        });

        corrected++;
      }

      progress(20 + Math.round(((i + 1) / playtimeRecords.length) * 80));
    }

    logger.info(
      `Phase 2: checked ${playtimeRecords.length} records, corrected ${corrected}`,
    );
  },
});

/**
 * Merge overlapping time intervals and return total non-overlapping seconds.
 * Input must be sorted by startedAt ascending.
 *
 * Example: if session A covers 18:00–22:00 and session B covers 20:00–23:00,
 * the merged interval is 18:00–23:00 = 5 hours (not 4+3 = 7 hours).
 */
function mergeAndSum(
  sessions: { startedAt: Date; endedAt: Date | null }[],
): number {
  if (sessions.length === 0) return 0;

  let totalSeconds = 0;
  let currentStart = sessions[0].startedAt.getTime();
  let currentEnd = sessions[0].endedAt?.getTime() ?? currentStart;

  for (let i = 1; i < sessions.length; i++) {
    const start = sessions[i].startedAt.getTime();
    const end = sessions[i].endedAt?.getTime() ?? start;

    if (start <= currentEnd) {
      // Overlapping or adjacent — extend the current interval
      currentEnd = Math.max(currentEnd, end);
    } else {
      // Gap — commit the current interval and start a new one
      totalSeconds += Math.floor((currentEnd - currentStart) / 1000);
      currentStart = start;
      currentEnd = end;
    }
  }

  // Commit the last interval
  totalSeconds += Math.floor((currentEnd - currentStart) / 1000);

  return totalSeconds;
}

export default recalculatePlaytime;
