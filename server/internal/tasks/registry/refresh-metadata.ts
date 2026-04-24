import { defineDropTask } from "..";
import prisma from "../../db/database";

/**
 * Audits metadata freshness across the library. Does NOT re-fetch from
 * providers — that path (MetadataHandler.createGame) involves object
 * creation and is not safely idempotent for already-imported games.
 *
 * Instead this task surfaces games with suspicious or missing metadata
 * so an admin can re-link them manually:
 *   • missing short/long description
 *   • missing cover/banner/icon object IDs
 *   • mReleased in the future (a common bad-data signal from providers)
 *   • Manual metadata source (deliberately never auto-refreshed)
 */
export default defineDropTask({
  buildId: () => `refresh:metadata:${new Date().toISOString()}`,
  name: "Audit Metadata",
  acls: ["system:maintenance:read"],
  taskGroup: "refresh:metadata",

  async run({ progress, logger }) {
    const games = await prisma.game.findMany({
      select: {
        id: true,
        mName: true,
        metadataSource: true,
        mShortDescription: true,
        mDescription: true,
        mReleased: true,
        mIconObjectId: true,
        mBannerObjectId: true,
        mCoverObjectId: true,
      },
    });

    logger.info(`Auditing metadata for ${games.length} game(s)`);

    const now = Date.now();
    const bySource: Record<string, number> = {};
    const problems: string[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      bySource[g.metadataSource] = (bySource[g.metadataSource] ?? 0) + 1;

      const issues: string[] = [];
      if (!g.mShortDescription?.trim()) issues.push("no short description");
      if (!g.mDescription?.trim()) issues.push("no description");
      if (!g.mIconObjectId) issues.push("no icon");
      if (!g.mBannerObjectId) issues.push("no banner");
      if (!g.mCoverObjectId) issues.push("no cover");
      if (
        g.mReleased &&
        g.mReleased.getTime() > now + 365 * 24 * 60 * 60 * 1000
      ) {
        // Released more than a year in the future — almost certainly a bad row.
        issues.push(
          `release date ${g.mReleased.toISOString().slice(0, 10)} is far future`,
        );
      }

      if (issues.length > 0) {
        problems.push(
          `${g.mName} [${g.metadataSource}] — ${issues.join(", ")}`,
        );
      }

      progress(Math.round(((i + 1) / games.length) * 100));
    }

    logger.info("Metadata by source:");
    for (const [src, count] of Object.entries(bySource)) {
      logger.info(`  ${src}: ${count}`);
    }

    if (problems.length === 0) {
      logger.info("No metadata issues found.");
    } else {
      logger.info(
        `Found ${problems.length} game(s) with missing or suspicious metadata:`,
      );
      for (const p of problems) logger.info(`  ${p}`);
      logger.info(
        "Fix by re-linking these games from the admin library page. Manual-source games are never auto-refreshed.",
      );
    }
  },
});
