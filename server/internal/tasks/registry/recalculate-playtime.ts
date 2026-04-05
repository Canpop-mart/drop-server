import { defineDropTask } from "..";
import prisma from "../../db/database";
import { mergeAndSumSessions } from "../../playtime/merge-sessions";

/**
 * Sanitizes PlaySession records and recomputes cumulative Playtime.
 *
 * Phase 1 — Close orphaned sessions (open > 1 hour).
 *           Ended at the earlier of (startedAt + actual elapsed) or now.
 *
 * Phase 2 — For every game/user pair that has at least one finished session,
 *           merge overlapping time intervals and upsert the correct
 *           cumulative Playtime.seconds value.
 *
 * Safe to run at any time — fully idempotent.
 */
const recalculatePlaytime = defineDropTask({
  buildId: () => `recalculate-playtime-${Date.now()}`,
  taskGroup: "recalculate:playtime",
  name: "Recalculate Playtime",
  acls: ["system:maintenance:read"],
  async run({ logger, progress }) {
    // ── Phase 1: Close orphaned sessions ───────────────────────────
    logger.info("Phase 1: Closing orphaned sessions (open > 1 hour)");

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const orphans = await prisma.playSession.findMany({
      where: {
        endedAt: null,
        startedAt: { lt: oneHourAgo },
      },
      select: { id: true, startedAt: true, lastHeartbeatAt: true },
    });

    for (const orphan of orphans) {
      // Prefer lastHeartbeatAt for accurate end time when client crashed
      const endedAt = orphan.lastHeartbeatAt ?? new Date();
      const elapsed = Math.floor(
        (endedAt.getTime() - orphan.startedAt.getTime()) / 1000,
      );

      await prisma.playSession.updateMany({
        where: { id: orphan.id },
        data: { endedAt, durationSeconds: elapsed },
      });
    }

    logger.info(`Phase 1: closed ${orphans.length} orphaned sessions`);
    progress(10);

    // ── Phase 2: Recompute cumulative totals (merge overlaps) ──────
    logger.info(
      "Phase 2: Recomputing cumulative playtime (merging overlapping sessions)",
    );

    // Find every distinct game/user pair that has at least one finished session.
    const pairs = await prisma.playSession.groupBy({
      by: ["gameId", "userId"],
      where: { endedAt: { not: null } },
    });

    let corrected = 0;

    for (let i = 0; i < pairs.length; i++) {
      const { gameId, userId } = pairs[i];

      const sessions = await prisma.playSession.findMany({
        where: {
          gameId,
          userId,
          endedAt: { not: null },
        },
        orderBy: { startedAt: "asc" },
        select: { startedAt: true, endedAt: true },
      });

      const correctSeconds = mergeAndSumSessions(sessions);

      // Fetch the current rollup (if any) to check whether it needs updating
      const existing = await prisma.playtime.findUnique({
        where: { gameId_userId: { gameId, userId } },
        select: { seconds: true },
      });

      if (!existing || existing.seconds !== correctSeconds) {
        logger.info(
          `Correcting playtime for game=${gameId} user=${userId}: ` +
            `${existing?.seconds ?? 0}s (${((existing?.seconds ?? 0) / 3600).toFixed(1)}h) → ` +
            `${correctSeconds}s (${(correctSeconds / 3600).toFixed(1)}h) ` +
            `[${sessions.length} sessions]`,
        );

        await prisma.playtime.upsert({
          where: { gameId_userId: { gameId, userId } },
          create: { gameId, userId, seconds: correctSeconds },
          update: { seconds: correctSeconds },
        });

        corrected++;
      }

      progress(10 + Math.round(((i + 1) / pairs.length) * 90));
    }

    logger.info(
      `Phase 2: checked ${pairs.length} game/user pairs, corrected ${corrected}`,
    );
  },
});

export default recalculatePlaytime;
