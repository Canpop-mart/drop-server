import fs from "fs";
import path from "path";
import os from "os";
import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Produces a JSON snapshot of Drop's content database and writes it to
 * $DATA/backups/drop-backup-<ISO>.json. This is intentionally a logical
 * export, not a pg_dump — no password, no cron, no external binaries.
 *
 * The snapshot is suitable for disaster recovery of the *configuration*
 * surface: games, versions, libraries, users, tasks. Object storage
 * (icons/banners) and library files are NOT backed up here — those live
 * on /data/objects and /library respectively and should be backed up by
 * the host (DSM, rsync, etc.).
 *
 * Sensitive fields (password hashes, TOTP secrets, API keys) are included
 * so restoring users keep working. Treat the backup file like a DB dump.
 */
export default defineDropTask({
  buildId: () => `backup:export:${new Date().toISOString()}`,
  name: "Export Backup",
  acls: ["system:maintenance:read"],
  taskGroup: "backup:export",

  async run({ progress, logger }) {
    const dataRoot = process.env.DATA ?? "/data";
    const backupDir = path.join(dataRoot, "backups");
    fs.mkdirSync(backupDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(backupDir, `drop-backup-${stamp}.json`);

    logger.info(`Writing snapshot to ${outFile}`);
    progress(5);

    const snapshot: Record<string, unknown> = {
      meta: {
        exportedAt: new Date().toISOString(),
        hostname: os.hostname(),
        nodeVersion: process.version,
      },
    };

    // Pull each table in sequence so a partial failure is obvious.
    // Ordering mirrors the roughly-dependency order used by Prisma schema.
    const steps: { key: string; fn: () => Promise<unknown> }[] = [
      { key: "applicationSettings", fn: () => prisma.applicationSettings.findMany() },
      { key: "library", fn: () => prisma.library.findMany() },
      { key: "user", fn: () => prisma.user.findMany() },
      { key: "game", fn: () => prisma.game.findMany() },
      { key: "gameVersion", fn: () => prisma.gameVersion.findMany() },
      { key: "launchConfiguration", fn: () => prisma.launchConfiguration.findMany() },
      { key: "setupConfiguration", fn: () => prisma.setupConfiguration.findMany() },
      { key: "company", fn: () => prisma.company.findMany() },
      { key: "gameTag", fn: () => prisma.gameTag.findMany() },
      { key: "gameRating", fn: () => prisma.gameRating.findMany() },
      { key: "achievement", fn: () => prisma.achievement.findMany() },
      { key: "userAchievement", fn: () => prisma.userAchievement.findMany() },
      { key: "gameExternalLink", fn: () => prisma.gameExternalLink.findMany() },
      { key: "playtime", fn: () => prisma.playtime.findMany() },
      { key: "playSession", fn: () => prisma.playSession.findMany() },
      { key: "collection", fn: () => prisma.collection.findMany() },
      { key: "collectionEntry", fn: () => prisma.collectionEntry.findMany() },
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        const rows = await step.fn();
        snapshot[step.key] = rows;
        logger.info(
          `  ${step.key}: ${Array.isArray(rows) ? rows.length : 1} row(s)`,
        );
      } catch (e) {
        logger.info(
          `  ${step.key}: failed — ${e instanceof Error ? e.message : String(e)}`,
        );
        snapshot[step.key] = { error: String(e) };
      }
      progress(5 + Math.round(((i + 1) / steps.length) * 85));
    }

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf8");
    const stats = fs.statSync(outFile);
    logger.info(`Wrote ${outFile} (${(stats.size / 1024).toFixed(1)} KB)`);
    progress(95);

    // Prune old backups — keep the 10 most recent.
    const existing = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("drop-backup-") && f.endsWith(".json"))
      .map((f) => ({ f, full: path.join(backupDir, f) }))
      .sort(
        (a, b) =>
          fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs,
      );

    const KEEP = 10;
    if (existing.length > KEEP) {
      for (const old of existing.slice(KEEP)) {
        try {
          fs.unlinkSync(old.full);
          logger.info(`  pruned ${old.f}`);
        } catch (e) {
          logger.info(
            `  could not prune ${old.f}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    progress(100);
  },
});
