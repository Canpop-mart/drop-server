import { defineDropTask } from "..";
import prisma from "../../db/database";

const MAX_SESSION_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Sanitizes individual PlaySession records and recomputes cumulative
 * Playtime.seconds from the corrected data.
 *
 * Phase 1 — Cap inflated sessions:
 *   Any session whose durationSeconds exceeds 24 hours is capped.
 *   Any open session (no endedAt) older than 4 hours is force-closed.
 *   Sessions with durationSeconds that don't match their timestamps
 *   are recalculated from startedAt/endedAt.
 *
 * Phase 2 — Recompute cumulative totals:
 *   For every game/user pair, sums the (now-sanitized) session durations
 *   and overwrites Playtime.seconds.
 *
 * Safe to run at any time — idempotent.
 */
const recalculatePlaytime = defineDropTask({
  buildId: () => `recalculate-playtime-${Date.now()}`,
  taskGroup: "recalculate:playtime",
  name: "Recalculate Playtime",
  acls: ["system:maintenance:read"],
  async run({ logger, progress }) {
    // ── Phase 1: Sanitize individual sessions ──────────────────────
    logger.info("Phase 1: Sanitizing individual play sessions");

    // 1a. Force-close orphaned sessions (open > 4 hours)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const orphans = await prisma.playSession.findMany({
      where: {
        endedAt: null,
        startedAt: { lt: fourHoursAgo },
      },
      select: { id: true, startedAt: true },
    });

    if (orphans.length > 0) {
      logger.info(`Closing ${orphans.length} orphaned sessions`);
      for (const orphan of orphans) {
        const endedAt = new Date(
          Math.min(
            orphan.startedAt.getTime() + MAX_SESSION_SECONDS * 1000,
            Date.now(),
          ),
        );
        const durationSeconds = Math.min(
          Math.floor((endedAt.getTime() - orphan.startedAt.getTime()) / 1000),
          MAX_SESSION_SECONDS,
        );
        await prisma.playSession.updateMany({
          where: { id: orphan.id },
          data: { endedAt, durationSeconds },
        });
      }
    }

    // 1b. Fix sessions with incorrect or inflated durationSeconds
    const allSessions = await prisma.playSession.findMany({
      where: { endedAt: { not: null } },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        gameId: true,
        userId: true,
      },
    });

    let sessionsCapped = 0;
    let sessionsRecalculated = 0;

    for (const session of allSessions) {
      if (!session.endedAt) continue;

      const realSeconds = Math.floor(
        (session.endedAt.getTime() - session.startedAt.getTime()) / 1000,
      );
      const cappedSeconds = Math.min(
        Math.max(realSeconds, 0),
        MAX_SESSION_SECONDS,
      );

      const stored = session.durationSeconds ?? 0;

      if (stored !== cappedSeconds) {
        if (stored > MAX_SESSION_SECONDS) {
          logger.info(
            `Capping session ${session.id}: ${stored}s → ${cappedSeconds}s`,
          );
          sessionsCapped++;
        } else {
          sessionsRecalculated++;
        }

        await prisma.playSession.updateMany({
          where: { id: session.id },
          data: { durationSeconds: cappedSeconds },
        });
      }
    }

    logger.info(
      `Phase 1 done: ${orphans.length} orphans closed, ${sessionsCapped} sessions capped, ${sessionsRecalculated} sessions recalculated`,
    );

    progress(50);

    // ── Phase 2: Recompute cumulative totals ───────────────────────
    logger.info("Phase 2: Recomputing cumulative playtime totals");

    const playtimeRecords = await prisma.playtime.findMany({
      select: { gameId: true, userId: true, seconds: true },
    });

    let corrected = 0;

    for (let i = 0; i < playtimeRecords.length; i++) {
      const record = playtimeRecords[i];

      const aggregate = await prisma.playSession.aggregate({
        where: {
          gameId: record.gameId,
          userId: record.userId,
          endedAt: { not: null },
          durationSeconds: { not: null },
        },
        _sum: { durationSeconds: true },
      });

      const correctSeconds = aggregate._sum.durationSeconds ?? 0;

      if (record.seconds !== correctSeconds) {
        logger.info(
          `Correcting playtime for game=${record.gameId} user=${record.userId}: ` +
            `${record.seconds}s → ${correctSeconds}s (was off by ${record.seconds - correctSeconds}s)`,
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

      progress(
        50 + Math.round(((i + 1) / playtimeRecords.length) * 50),
      );
    }

    logger.info(
      `Phase 2 done: checked ${playtimeRecords.length} records, corrected ${corrected}.`,
    );
  },
});

export default recalculatePlaytime;
