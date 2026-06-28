import { type, ArkErrors } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import notificationSystem from "~/server/internal/notifications";
import { logger } from "~/server/internal/logging";
import { unlocksRepo } from "~/server/internal/achievements";

// Sanity bounds on client-reported achievement unlocks. A single report batch
// can't exceed 500 unlocks (a single player legitimately unlocking 500
// achievements in a single report is implausible even for completion dumps —
// the client should chunk if it has more). We also reject unlockedAt dates
// that are in the future or absurdly far in the past.
const MAX_ACHIEVEMENTS_PER_REPORT = 500;
const ALLOWED_CLOCK_SKEW_SECS = 5 * 60; // 5 min for client clock drift
const OLDEST_PLAUSIBLE_UNLOCK = new Date("2000-01-01T00:00:00Z");

const AchievementReport = type({
  achievements: type({
    externalId: "string",
    provider: "'Goldberg' | 'RetroAchievements'",
    unlockedAt: "string",
  })
    .array()
    .atMostLength(MAX_ACHIEVEMENTS_PER_REPORT),
});

export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const rawBody = await readBody(h3);
  const body = AchievementReport(rawBody);
  if (body instanceof ArkErrors) {
    logger.warn(
      `[ACH] Report validation failed for game ${gameId}:`,
      body.summary,
    );
    throw createError({ statusCode: 400, statusMessage: body.summary });
  }

  logger.info(
    `[ACH:goldberg] Report received: game=${gameId} user=${user.id} count=${body.achievements.length}`,
  );

  // Fetch game name + all matching achievements in bulk (avoids N+1)
  const [game, achievements, existingUnlocks] = await Promise.all([
    prisma.game.findUnique({
      where: { id: gameId },
      select: { mName: true },
    }),
    prisma.achievement.findMany({
      where: {
        gameId,
        // Every file-based unlock (Goldberg / SmartSteamEmu / CODEX / RUNE /
        // OnlineFix / … / the real Steam client cache) is reported by the
        // client under "Goldberg", and every Steam-style definition is stored
        // under the Goldberg provider — the only Achievement writer is
        // achievementsRepo.upsertDefinitions, which only ever writes Goldberg
        // or RetroAchievements, never Steam. RA unlocks arrive via /ra-poll,
        // not this endpoint, so we match Goldberg rows by externalId.
        provider: "Goldberg",
        externalId: {
          in: body.achievements.map((a) => a.externalId),
        },
      },
    }),
    prisma.userAchievement.findMany({
      where: {
        userId: user.id,
        achievement: {
          gameId,
          externalId: {
            in: body.achievements.map((a) => a.externalId),
          },
        },
      },
      select: { achievementId: true },
    }),
  ]);

  // Look up reported unlocks by their externalId (the Steam API name).
  const achievementMap = new Map<string, (typeof achievements)[number]>(
    achievements.map((a) => [a.externalId, a]),
  );
  const alreadyUnlockedIds = new Set(
    existingUnlocks.map((u) => u.achievementId),
  );

  let recorded = 0;
  let skipped = 0;
  const newlyUnlocked: { title: string; iconUrl: string }[] = [];

  for (const report of body.achievements) {
    const achievement = achievementMap.get(report.externalId);
    if (!achievement) {
      skipped++;
      logger.warn(
        `[ACH:goldberg] Achievement NOT FOUND in DB: gameId=${gameId} externalId=${report.externalId}`,
      );
      continue;
    }

    // Validate the reported unlock timestamp. Client-supplied dates are clamped
    // to [OLDEST_PLAUSIBLE_UNLOCK, now + ALLOWED_CLOCK_SKEW]. Out-of-range values
    // are coerced to "now" rather than rejected — we already validated the
    // unlock against the achievement definition, so the unlock itself is
    // legitimate; we just don't trust the reported time.
    const parsedUnlockedAt = new Date(report.unlockedAt);
    const nowMs = Date.now();
    const maxAllowedMs = nowMs + ALLOWED_CLOCK_SKEW_SECS * 1000;
    const unlockedAt =
      isNaN(parsedUnlockedAt.getTime()) ||
      parsedUnlockedAt.getTime() > maxAllowedMs ||
      parsedUnlockedAt < OLDEST_PLAUSIBLE_UNLOCK
        ? new Date(nowMs)
        : parsedUnlockedAt;

    // Canonical unlock write path — idempotent upsert keyed on
    // (userId, achievementId). The RA poll / session-end paths use the
    // same repo, so the same unlock can never be double-credited.
    const { created } = await unlocksRepo.recordUnlock({
      userId: user.id,
      achievementId: achievement.id,
      source: "client-report",
      occurredAt: unlockedAt,
    });

    recorded++;

    // `created` from the repo is the source of truth, but cross-check
    // against the pre-fetched set too (defends against a stale read).
    if (created && !alreadyUnlockedIds.has(achievement.id)) {
      newlyUnlocked.push({
        title: achievement.title,
        iconUrl: achievement.iconUrl ?? "",
      });
    }
  }

  // Push real-time notifications for each newly unlocked achievement
  for (const unlock of newlyUnlocked) {
    await notificationSystem
      .push(user.id, {
        title: unlock.title,
        description: game?.mName ?? "",
        actions: unlock.iconUrl ? [unlock.iconUrl] : [],
        nonce: `achievement-unlock:${gameId}:${unlock.title}:${Date.now()}`,
        acls: ["user:store:read"],
      })
      .catch((err) => {
        logger.warn(`[ACH:goldberg] Failed to push notification: ${err}`);
      });
  }

  logger.info(
    `[ACH:goldberg] Report complete: game=${gameId} matched=${recorded} newlyUnlocked=${newlyUnlocked.length} notFound=${skipped}`,
  );

  // `recorded` = reports matched to a stored definition (kept for client
  // back-compat); `newlyUnlocked` = rows actually created by this call;
  // `skipped` = reports with no matching definition — the silent drop the
  // client should surface (an externalId/definition mismatch), not a normal
  // "already unlocked".
  return { recorded, newlyUnlocked: newlyUnlocked.length, skipped };
});
