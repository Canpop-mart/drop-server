import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Recomputes every user's cumulative Playtime.seconds from their
 * actual PlaySession records. This fixes any drift caused by
 * double-counted orphan close-outs or other incremental accounting bugs.
 *
 * Safe to run at any time — it's a full recalculation, not incremental.
 */
const recalculatePlaytime = defineDropTask({
  buildId: () => `recalculate-playtime-${Date.now()}`,
  taskGroup: "recalculate:playtime",
  name: "Recalculate Playtime",
  acls: ["system:maintenance:read"],
  async run({ logger, progress }) {
    // Get all distinct game/user pairs that have a Playtime record
    const playtimeRecords = await prisma.playtime.findMany({
      select: { gameId: true, userId: true, seconds: true },
    });

    logger.info(`Found ${playtimeRecords.length} playtime records to check`);

    let corrected = 0;

    for (let i = 0; i < playtimeRecords.length; i++) {
      const record = playtimeRecords[i];

      // Sum all finished session durations for this game/user
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
            `${record.seconds}s → ${correctSeconds}s (delta: ${record.seconds - correctSeconds}s)`,
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

      progress(Math.round(((i + 1) / playtimeRecords.length) * 100));
    }

    logger.info(
      `Done. Checked ${playtimeRecords.length} records, corrected ${corrected}.`,
    );
  },
});

export default recalculatePlaytime;
