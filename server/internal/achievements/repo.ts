/**
 * Achievement subsystem — canonical write paths.
 *
 * Two repos, two jobs:
 *   - `achievementsRepo.upsertDefinitions` — the ONLY way achievement
 *     definitions get written. `setupGoldberg`, the RA link/scan
 *     endpoints and the scan tasks all funnel through here, so the
 *     upsert-by-(gameId, provider, externalId) logic lives in one place.
 *   - `unlocksRepo.recordUnlock` — the ONLY way a UserAchievement row is
 *     created. It upserts against the `(userId, achievementId)` unique
 *     constraint, so the client-report path, the RA poll path and the
 *     session-end path can never double-credit the same unlock.
 *
 * See docs/audit/achievements-2026.md for the rationale.
 */
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";
import { logger } from "~/server/internal/logging";
import { invalidateGameAchievementConfig } from "./config-cache";
import type { AchievementDefinition, UnlockInput } from "./types";

type ProviderKey = Extract<
  ExternalAccountProvider,
  "Goldberg" | "RetroAchievements"
>;

/** Log prefix per provider so scan output is greppable. */
function prefix(provider: ProviderKey): string {
  return provider === "Goldberg" ? "[ACH:goldberg]" : "[ACH:ra]";
}

export const achievementsRepo = {
  /**
   * Upsert a full set of achievement definitions for one game+provider.
   *
   * Idempotent: re-running with the same defs only refreshes title /
   * description / icon / order. `displayOrder` is taken from the array
   * index when a def doesn't carry one, so callers can just pass an
   * ordered list.
   *
   * Returns the number of definitions written (created + updated).
   */
  async upsertDefinitions(
    gameId: string,
    provider: ProviderKey,
    defs: AchievementDefinition[],
  ): Promise<number> {
    if (defs.length === 0) {
      logger.info(
        `${prefix(provider)} upsertDefinitions: no definitions for game=${gameId}`,
      );
      return 0;
    }

    let written = 0;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const externalId = def.externalId?.trim();
      if (!externalId) continue;

      await prisma.achievement.upsert({
        where: {
          gameId_provider_externalId: { gameId, provider, externalId },
        },
        create: {
          gameId,
          provider,
          externalId,
          title: def.title || externalId,
          description: def.description || "",
          iconUrl: def.iconUrl || "",
          iconLockedUrl: def.iconLockedUrl || "",
          displayOrder: def.displayOrder ?? i,
          points: def.points ?? 0,
          globalPercent: def.globalPercent ?? null,
        },
        update: {
          title: def.title || externalId,
          description: def.description || "",
          iconUrl: def.iconUrl || "",
          iconLockedUrl: def.iconLockedUrl || "",
          displayOrder: def.displayOrder ?? i,
          points: def.points ?? 0,
          globalPercent: def.globalPercent ?? null,
        },
      });
      written++;
    }

    // New / changed definitions — drop the cached config so the next
    // client poll reflects them instead of waiting out the TTL.
    if (written > 0) invalidateGameAchievementConfig(gameId);

    logger.info(
      `${prefix(provider)} upsertDefinitions: wrote ${written} definition(s) for game=${gameId}`,
    );
    return written;
  },
};

export const unlocksRepo = {
  /**
   * Record a single achievement unlock for a user.
   *
   * This is the ONE call site that creates UserAchievement rows. It
   * upserts against the `(userId, achievementId)` unique constraint:
   *
   *   - First unlock  → row created, `unlockedAt` + `source` stored.
   *   - Repeat report → no-op update. The original `unlockedAt` and
   *     `source` are preserved (we trust the first sighting most).
   *
   * Because it's an upsert against a unique key, two different write
   * paths (Goldberg client report + RA poll + RA session-end) reporting
   * the same unlock CANNOT create two rows — double-credit is
   * structurally impossible, not just defended against.
   *
   * Returns `{ created }` — true only when this call inserted the row,
   * so callers can decide whether to fire an unlock notification.
   */
  async recordUnlock(input: UnlockInput): Promise<{ created: boolean }> {
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId: input.userId,
          achievementId: input.achievementId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      // Already credited — keep the original sighting untouched.
      return { created: false };
    }

    try {
      await prisma.userAchievement.create({
        data: {
          userId: input.userId,
          achievementId: input.achievementId,
          unlockedAt: input.occurredAt,
          source: input.source,
        },
      });
      return { created: true };
    } catch (e) {
      // A concurrent writer may have inserted the row between our
      // findUnique and create (P2002 unique violation). That's the
      // idempotency guarantee doing its job — treat as "already
      // credited" rather than an error.
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        logger.info(
          `[ACH] recordUnlock: concurrent insert for user=${input.userId} ach=${input.achievementId} — treated as already unlocked`,
        );
        return { created: false };
      }
      throw e;
    }
  },
};
