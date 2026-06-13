import fs from "fs";
import path from "path";
import zlib from "zlib";
import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Tiers GameCompatibilityResult log excerpts so launch telemetry doesn't pile
 * up on the NAS forever:
 *   - HOT (0–7 days): the excerpt stays in the DB, queryable by the dashboard.
 *   - COLD (7–30 days): it's gzipped to $DATA/compat-logs/<id>.log.gz and the
 *     DB column is nulled — still fetchable for debugging, but out of the hot DB.
 *   - PURGED (>30 days): the gzip file is deleted. The compact result row
 *     (status / signature / version / proton) is tiny and kept indefinitely.
 *
 * Cold-file age comes from the file's own mtime (written once at the 7-day
 * mark, never touched), so PURGE is a bounded directory scan rather than an
 * ever-growing "all old results" query. Bucketed into the daily scheduler.
 */
const HOT_DAYS = 7;
const COLD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default defineDropTask({
  buildId: () => `cleanup:compat-logs:${new Date().toISOString()}`,
  name: "Tier Compatibility Logs",
  acls: ["system:maintenance:read"],
  taskGroup: "cleanup:compat-logs",

  async run({ progress, logger }) {
    const coldDir = path.join(process.env.DATA ?? "/data", "compat-logs");
    fs.mkdirSync(coldDir, { recursive: true });

    const now = Date.now();
    const hotCutoff = new Date(now - HOT_DAYS * DAY_MS);

    // ── HOT → COLD: gzip excerpts older than HOT_DAYS, null the column ──
    const toArchive = await prisma.gameCompatibilityResult.findMany({
      where: { logExcerpt: { not: null }, testedAt: { lt: hotCutoff } },
      select: { id: true, logExcerpt: true },
    });
    logger.info(
      `Archiving ${toArchive.length} excerpt(s) older than ${HOT_DAYS}d to cold storage`,
    );
    progress(10);

    let archived = 0;
    for (const r of toArchive) {
      try {
        const gz = zlib.gzipSync(Buffer.from(r.logExcerpt ?? "", "utf8"));
        fs.writeFileSync(path.join(coldDir, `${r.id}.log.gz`), gz);
        await prisma.gameCompatibilityResult.updateMany({
          where: { id: r.id },
          data: { logExcerpt: null },
        });
        archived++;
      } catch (e) {
        logger.info(
          `  archive failed for ${r.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    logger.info(`Archived ${archived} excerpt(s)`);
    progress(60);

    // ── PURGE: drop cold files whose mtime age exceeds (COLD - HOT) days ──
    // A cold file is created at the 7-day mark, so an mtime age of 30-7=23
    // days means the underlying result is >30 days old.
    const purgeAgeMs = (COLD_DAYS - HOT_DAYS) * DAY_MS;
    let purged = 0;
    let scanned = 0;
    for (const f of fs.readdirSync(coldDir)) {
      if (!f.endsWith(".log.gz")) continue;
      scanned++;
      const full = path.join(coldDir, f);
      try {
        if (now - fs.statSync(full).mtimeMs > purgeAgeMs) {
          fs.unlinkSync(full);
          purged++;
        }
      } catch (e) {
        logger.info(
          `  purge failed for ${f}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    logger.info(
      `Purged ${purged}/${scanned} cold log file(s) older than ${COLD_DAYS}d`,
    );
    progress(100);
  },
});
