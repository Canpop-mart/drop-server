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
    // ── Phase 0: Fix previously corrupted sessions ──────────────────
    // A prior bug set endedAt = now() for sessions with no heartbeat,
    // giving them days/weeks of fake playtime. Fix by recapping sessions
    // whose duration far exceeds their heartbeat window.
    logger.info("Phase 0: Fixing previously corrupted session durations");

    const suspiciousSessions = await prisma.playSession.findMany({
      where: {
        endedAt: { not: null },
        durationSeconds: { gt: 4 * 60 * 60 }, // > 4 hours
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        lastHeartbeatAt: true,
        durationSeconds: true,
      },
    });

    let fixedCount = 0;
    for (const session of suspiciousSessions) {
      // If the session has a heartbeat, the real duration is startedAt → lastHeartbeat + grace
      // If no heartbeat, the real duration is capped at 5 minutes
      let correctEnd: Date;
      if (session.lastHeartbeatAt) {
        correctEnd = new Date(
          session.lastHeartbeatAt.getTime() + 10 * 60 * 1000,
        );
      } else {
        correctEnd = new Date(session.startedAt.getTime() + 5 * 60 * 1000);
      }

      // Only fix if the stored endedAt is significantly past the correct end
      const storedEnd = session.endedAt!.getTime();
      const correctEndMs = correctEnd.getTime();
      if (storedEnd > correctEndMs + 60 * 1000) {
        // > 1 minute past correct
        const correctedDuration = Math.floor(
          (correctEnd.getTime() - session.startedAt.getTime()) / 1000,
        );
        await prisma.playSession.updateMany({
          where: { id: session.id },
          data: { endedAt: correctEnd, durationSeconds: correctedDuration },
        });
        fixedCount++;
      }
    }
    logger.info(
      `Phase 0: checked ${suspiciousSessions.length} long sessions, fixed ${fixedCount}`,
    );
    progress(5);

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

    // Maximum session duration when no heartbeat exists.
    // If the client never heartbeated, the game likely crashed immediately
    // or ran very briefly. Cap at 5 minutes to avoid inflating playtime
    // with days-old orphaned sessions.
    const MAX_NO_HEARTBEAT_SECONDS = 5 * 60; // 5 minutes

    // If a heartbeat exists, cap at heartbeat + 10 minutes (the client
    // heartbeats every ~5 min, so 10 min past the last one is generous).
    const HEARTBEAT_GRACE_SECONDS = 10 * 60; // 10 minutes

    for (const orphan of orphans) {
      let endedAt: Date;
      if (orphan.lastHeartbeatAt) {
        // Use last heartbeat + grace period (not now, which could be days later)
        endedAt = new Date(
          orphan.lastHeartbeatAt.getTime() + HEARTBEAT_GRACE_SECONDS * 1000,
        );
      } else {
        // No heartbeat at all — game likely crashed. Cap duration.
        endedAt = new Date(
          orphan.startedAt.getTime() + MAX_NO_HEARTBEAT_SECONDS * 1000,
        );
      }

      // Never set endedAt past the current time
      const now = new Date();
      if (endedAt > now) endedAt = now;

      const elapsed = Math.floor(
        (endedAt.getTime() - orphan.startedAt.getTime()) / 1000,
      );

      await prisma.playSession.updateMany({
        where: { id: orphan.id },
        data: { endedAt, durationSeconds: elapsed },
      });
    }

    logger.info(`Phase 1: closed ${orphans.length} orphaned sessions`);
    progress(15);

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

      progress(15 + Math.round(((i + 1) / pairs.length) * 85));
    }

    logger.info(
      `Phase 2: checked ${pairs.length} game/user pairs, corrected ${corrected}`,
    );
  },
});

export default recalculatePlaytime;
