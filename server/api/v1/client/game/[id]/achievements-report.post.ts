import { type, ArkErrors } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";
import notificationSystem from "~/server/internal/notifications";
import { logger } from "~/server/internal/logging";

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
    `[ACH] Report received: game=${gameId} user=${user.id} count=${body.achievements.length}`,
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
        provider: "Goldberg" as ExternalAccountProvider,
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

  // Build lookup maps
  const achievementMap = new Map(
    achievements.map((a) => [`${a.provider}:${a.externalId}`, a]),
  );
  const alreadyUnlockedIds = new Set(
    existingUnlocks.map((u) => u.achievementId),
  );

  let recorded = 0;
  const newlyUnlocked: { title: string; iconUrl: string }[] = [];

  for (const report of body.achievements) {
    const achievement = achievementMap.get(
      `${report.provider}:${report.externalId}`,
    );
    if (!achievement) {
      logger.warn(
        `[ACH] Achievement NOT FOUND in DB: gameId=${gameId} externalId=${report.externalId}`,
      );
      continue;
    }

    const wasAlreadyUnlocked = alreadyUnlockedIds.has(achievement.id);

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

    await prisma.userAchievement.upsert({
      where: {
        userId_achievementId: {
          userId: user.id,
          achievementId: achievement.id,
        },
      },
      create: {
        userId: user.id,
        achievementId: achievement.id,
        unlockedAt,
      },
      update: {},
    });

    recorded++;

    if (!wasAlreadyUnlocked) {
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
        logger.warn(`[ACH] Failed to push notification: ${err}`);
      });
  }

  logger.info(
    `[ACH] Report complete: game=${gameId} recorded=${recorded} newlyUnlocked=${newlyUnlocked.length}`,
  );

  return { recorded };
});
