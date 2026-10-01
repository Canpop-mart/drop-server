import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { resolveGameVersion, setupGoldberg } from "../../goldberg";

/**
 * Repairs already-imported Goldberg games whose achievements have no
 * description.
 *
 * Why this exists: until the definition merge landed, a non-empty local
 * `steam_settings/achievements.json` short-circuited the Steam lookup
 * entirely. Cracks routinely ship name + icon only, so those games got
 * achievement rows with `description = ""` and nothing ever went back to fix
 * them. New imports are fine now; this walks the existing library.
 *
 * Text only. It does not touch `globalPercent`: Drop's "% of players" figure
 * is deliberately measured against Drop's own player base, and the merge
 * leaves that field alone for the same reason.
 *
 * It re-runs `setupGoldberg` WITHOUT `forceRefreshAchievements`, which is the
 * point: the merge path keeps the local schema as the list of achievements
 * that exist and fills only the blanks from Steam. A force-refresh would
 * replace the crack's schema wholesale with Steam's, which is a different
 * (and more destructive) operation — that is what `refresh:achievement-defs`
 * is for.
 *
 * Safe to re-run. It never touches `UserAchievement`, so unlocks are not at
 * risk; the only writes are definition upserts and, when there is genuinely
 * better text to store, the game's own `achievements.json`.
 *
 * Games with NO achievement rows at all aren't selected here — that is a
 * different failure (missing steam_settings / never scanned) and belongs to
 * `scan:goldberg-readiness`.
 */

/**
 * Delay between games. Each game that actually needs Steam costs two
 * requests (GetSchemaForGame, plus the global-percentages call that fetch
 * makes alongside it), so a one-second gap holds the sweep at roughly two
 * requests per second even in the worst case where every game needs a lookup.
 * Games whose local file is already complete make no request at all and still
 * wait, which is the cheapest possible way to keep the pacing honest.
 * Concurrency is one on purpose: a parallel sweep is exactly what gets an IP
 * rate limited.
 */
const PACE_MS = 1000;

function countBlankDescriptions(gameId: string): Promise<number> {
  return prisma.achievement.count({
    where: {
      gameId,
      provider: ExternalAccountProvider.Goldberg,
      description: "",
    },
  });
}

export default defineDropTask({
  buildId: () => `backfill:achievement-text:${new Date().toISOString()}`,
  name: "Backfill Achievement Text",
  acls: ["system:maintenance:read"],
  taskGroup: "backfill:achievement-text",

  async run({ progress, logger }) {
    if (!process.env.STEAM_API_KEY) {
      logger.warn(
        "STEAM_API_KEY is not set, so this run cannot fill anything. " +
          "Achievement text comes from Steam's schema endpoint, which needs " +
          "the key. Set it and run this again. See .env.example.",
      );
      progress(100);
      return;
    }

    const games = await prisma.game.findMany({
      where: {
        achievements: {
          some: {
            provider: ExternalAccountProvider.Goldberg,
            description: "",
          },
        },
      },
      select: { id: true, mName: true },
      orderBy: { mName: "asc" },
    });

    if (games.length === 0) {
      logger.info(
        "No Goldberg game has an achievement with a blank description",
      );
      progress(100);
      return;
    }

    logger.info(
      `${games.length} game(s) have achievements with a blank description`,
    );

    let repaired = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    let filesRewritten = 0;
    let manifestsNotRegenerated = 0;
    let manifestsRegenerated = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const advance = () =>
        progress(Math.round(((i + 1) / games.length) * 100));

      const resolvedVersion = await resolveGameVersion(game.id);
      const versionDir = resolvedVersion?.versionDir;
      if (!versionDir) {
        logger.info(`${game.mName}: no version directory on disk, skipped`);
        skipped++;
        advance();
        continue;
      }

      const before = await countBlankDescriptions(game.id);

      try {
        const result = await setupGoldberg(game.id, versionDir, {
          versionId: resolvedVersion?.versionId,
          manifest: "now",
          swapDll: false,
          logger,
        });
        if (result.definitionsFileChanged) filesRewritten++;
        if (result.filesChanged) {
          if (result.manifestRegenerated) manifestsRegenerated++;
          else manifestsNotRegenerated++;
        }

        const after = await countBlankDescriptions(game.id);

        if (after < before) {
          logger.info(
            `${game.mName}: filled ${before - after} description(s), ${after} still blank`,
          );
          repaired++;
        } else {
          logger.info(
            `${game.mName}: nothing to fill (${after} blank description(s) left). Usually a ` +
              `hidden achievement, an achievement Steam doesn't list for this AppID, or Steam ` +
              `was unreachable.`,
          );
          unchanged++;
        }
      } catch (e) {
        logger.info(`${game.mName} failed: ${e}`);
        failed++;
      }

      advance();
      if (i < games.length - 1) {
        await new Promise((r) => setTimeout(r, PACE_MS));
      }
    }

    logger.info(
      `Backfill complete across ${games.length} game(s): ${repaired} repaired, ` +
        `${unchanged} left unchanged, ${skipped} skipped (no version directory), ${failed} failed`,
    );

    if (filesRewritten > 0) {
      logger.info(
        `${filesRewritten} game(s) had steam_settings/achievements.json rewritten on disk so the ` +
          `in-game overlay gets the same text. ${manifestsRegenerated} manifest(s) were regenerated ` +
          `in this run.`,
      );
    }
    if (manifestsNotRegenerated > 0) {
      logger.warn(
        `${manifestsNotRegenerated} game(s) changed on disk but their manifest could not be ` +
          `regenerated (see above). Run "Regenerate Manifests" to keep client downloads passing ` +
          `checksum validation.`,
      );
    }
  },
});
