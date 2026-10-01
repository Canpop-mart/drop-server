import { type, ArkErrors } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import notificationSystem from "~/server/internal/notifications";
import { logger } from "~/server/internal/logging";
import { resetsRepo, unlocksRepo } from "~/server/internal/achievements";

// Sanity bounds on client-reported achievement unlocks. A single report batch
// can't exceed 500 unlocks (a single player legitimately unlocking 500
// achievements in a single report is implausible even for completion dumps —
// the client should chunk if it has more). We also reject unlockedAt dates
// that are in the future or absurdly far in the past.
const MAX_ACHIEVEMENTS_PER_REPORT = 500;
const ALLOWED_CLOCK_SKEW_SECS = 5 * 60; // 5 min for client clock drift
// Client/server clock difference beyond which the client clock is treated as
// wrong rather than drifting (see largeSkew in the handler).
const LARGE_CLOCK_SKEW_MS = 15 * 60 * 1000;
const OLDEST_PLAUSIBLE_UNLOCK = new Date("2000-01-01T00:00:00Z");

const AchievementReport = type({
  // The client's clock when it sent the report. Newer clients send it so the
  // server can correct `unlockedAt` for clock skew before comparing it with
  // the (server-clock) reset marker.
  "clientNow?": "string",
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

  // Clock skew: how far the server's clock is ahead of the client's. Earned
  // times come from the client's clock (the emulator stamps them), while the
  // reset marker is server time; without this a client running a few minutes
  // slow would have genuine post-reset unlocks dropped as "before the reset".
  const serverNowMs = Date.now();
  const clientNowMs = body.clientNow ? new Date(body.clientNow).getTime() : NaN;
  const skewMs = Number.isNaN(clientNowMs) ? 0 : serverNowMs - clientNowMs;
  // Beyond this the client's clock is simply wrong (a Deck that lost its
  // time, say), and the correction is only right for unlocks stamped under
  // the current wrong clock, not for ones earned earlier while it was right.
  // Then the reset check takes whichever of the raw and corrected times is
  // earlier: a reset must never be undone by a correction, at the cost of
  // dropping genuinely new unlocks until the clock is fixed.
  const largeSkew = Math.abs(skewMs) > LARGE_CLOCK_SKEW_MS;
  if (Math.abs(skewMs) > 60_000) {
    logger.info(
      `[ACH:goldberg] Server clock is ${Math.round(skewMs / 1000)}s ahead of the client's ` +
        `for user=${user.id} (negative = behind); correcting reported unlock times`,
    );
  }

  // The player's reset marker for this game, looked up once. Unlocks earned
  // before it are ignored so a reset isn't undone by the save file on disk.
  const resetAt = await resetsRepo.getResetAt(user.id, gameId);

  let recorded = 0;
  let skipped = 0;
  let ignoredBeforeReset = 0;
  const newlyUnlocked: {
    id: string;
    externalId: string;
    title: string;
    description: string;
    iconUrl: string;
  }[] = [];

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
    // legitimate; we just don't trust the reported time. "Now" is after any
    // reset, so an unlock with no usable time gets past the reset marker;
    // the client clears its local save file on reset to cover that case.
    // Shifted onto the server's clock (see skewMs above).
    const rawMs = new Date(report.unlockedAt).getTime();
    const parsedUnlockedAt = new Date(rawMs + skewMs);
    const nowMs = Date.now();
    const maxAllowedMs = nowMs + ALLOWED_CLOCK_SKEW_SECS * 1000;
    const unlockedAt =
      isNaN(parsedUnlockedAt.getTime()) ||
      parsedUnlockedAt.getTime() > maxAllowedMs ||
      parsedUnlockedAt < OLDEST_PLAUSIBLE_UNLOCK
        ? new Date(nowMs)
        : parsedUnlockedAt;
    // What the reset marker is compared against (see largeSkew above).
    const resetCheckTime =
      largeSkew && !isNaN(rawMs) && rawMs < unlockedAt.getTime()
        ? new Date(rawMs)
        : unlockedAt;

    // Canonical unlock write path — idempotent upsert keyed on
    // (userId, achievementId). The RA poll / session-end paths use the
    // same repo, so the same unlock can never be double-credited.
    const { created, beforeReset } = await unlocksRepo.recordUnlock(
      {
        userId: user.id,
        gameId,
        achievementId: achievement.id,
        source: "client-report",
        occurredAt: unlockedAt,
      },
      { resetAt, resetCheckTime },
    );

    recorded++;
    if (beforeReset) ignoredBeforeReset++;

    // `created` from the repo is the source of truth, but cross-check
    // against the pre-fetched set too (defends against a stale read).
    if (created && !alreadyUnlockedIds.has(achievement.id)) {
      newlyUnlocked.push({
        id: achievement.id,
        externalId: achievement.externalId,
        title: achievement.title,
        description: achievement.description ?? "",
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
    `[ACH:goldberg] Report complete: game=${gameId} matched=${recorded} newlyUnlocked=${newlyUnlocked.length} ` +
      `notFound=${skipped} ignoredBeforeReset=${ignoredBeforeReset}`,
  );

  // `recorded` = reports matched to a stored definition (kept for client
  // back-compat); `newlyUnlocked` = rows actually created by this call;
  // `unlocks` = those same rows, so the client toasts exactly what the
  // server just recorded instead of diffing a cached config;
  // `skipped` = reports with no matching definition — the silent drop the
  // client should surface (an externalId/definition mismatch), not a normal
  // "already unlocked"; `ignoredBeforeReset` = matched reports earned before
  // the player's reset of this game.
  return {
    recorded,
    newlyUnlocked: newlyUnlocked.length,
    unlocks: newlyUnlocked,
    skipped,
    ignoredBeforeReset,
  };
});
