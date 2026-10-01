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
import { isBeforeReset, resetsRepo } from "./reset";
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
   * On update, an empty description / icon / rarity does NOT overwrite a
   * stored non-empty one — see the comment on `existingRows` below.
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

    // Existing rows for this game+provider, so an update can decline to
    // blank a field it already has good data for. A provider that can't
    // answer right now (Steam down, RA reporting zero players, a crack's
    // schema with no descriptions) sends "" / null, and writing that
    // through would silently destroy text a previous scan resolved.
    // Empty is "unknown", never "deliberately cleared".
    const existingRows = await prisma.achievement.findMany({
      where: { gameId, provider },
      select: {
        externalId: true,
        description: true,
        iconUrl: true,
        iconLockedUrl: true,
        globalPercent: true,
      },
    });
    const existing = new Map(existingRows.map((r) => [r.externalId, r]));

    let written = 0;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const externalId = def.externalId?.trim();
      if (!externalId) continue;

      const prev = existing.get(externalId);
      const keepText = (incoming: string | undefined, stored?: string) =>
        incoming || stored || "";

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
          description: keepText(def.description, prev?.description),
          iconUrl: keepText(def.iconUrl, prev?.iconUrl),
          iconLockedUrl: keepText(def.iconLockedUrl, prev?.iconLockedUrl),
          displayOrder: def.displayOrder ?? i,
          points: def.points ?? 0,
          globalPercent: def.globalPercent ?? prev?.globalPercent ?? null,
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
   * Resets: an unlock whose `occurredAt` is before the user's
   * `AchievementReset.resetAt` for this game is ignored (see reset.ts), so a
   * reset is not undone by the next report or RA sync. Callers that record
   * many unlocks for one game should pass `resetAt` (looked up once via
   * `resetsRepo.getResetAt`) as a cheap pre-filter; when it is omitted this
   * looks it up itself. Either way the marker is read again after inserting,
   * so a reset that happens mid-report can't be undone by it.
   *
   * Returns `{ created }` — true only when this call inserted the row,
   * so callers can decide whether to fire an unlock notification — and
   * `beforeReset`, true when the unlock was ignored for predating a reset.
   */
  async recordUnlock(
    input: UnlockInput,
    opts?: {
      resetAt?: Date | null;
      /**
       * The time to compare with the reset marker, when it should differ
       * from `occurredAt` (the client report with a badly wrong clock uses
       * the earlier of its raw and skew-corrected times). Defaults to
       * `occurredAt`.
       */
      resetCheckTime?: Date;
    },
  ): Promise<{ created: boolean; beforeReset: boolean }> {
    const checkTime = opts?.resetCheckTime ?? input.occurredAt;
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
      return { created: false, beforeReset: false };
    }

    const resetAt =
      opts?.resetAt !== undefined
        ? opts.resetAt
        : await resetsRepo.getResetAt(input.userId, input.gameId);
    if (isBeforeReset(checkTime, resetAt)) {
      // Debug, not info: RA progress repeats the same pre-reset unlocks on
      // every 15s poll for as long as the player keeps playing.
      logger.debug(
        `[ACH] recordUnlock: ignored ach=${input.achievementId} for user=${input.userId}: ` +
          `earned ${checkTime.toISOString()}, before the reset at ${resetAt?.toISOString()}`,
      );
      return { created: false, beforeReset: true };
    }

    try {
      const row = await prisma.userAchievement.create({
        data: {
          userId: input.userId,
          achievementId: input.achievementId,
          unlockedAt: input.occurredAt,
          source: input.source,
        },
        select: { id: true },
      });

      // Re-check the reset marker AFTER the insert. The `resetAt` above may
      // have been read before a reset that is happening right now. The reset
      // route writes its marker first and deletes rows second, so either
      // this read sees the new marker (and we remove our own row), or our
      // insert landed before the marker and the reset's delete removes it.
      // Checking before the insert instead would leave a window where a late
      // insert survives the reset.
      const latestResetAt = await resetsRepo.getResetAt(
        input.userId,
        input.gameId,
      );
      if (isBeforeReset(checkTime, latestResetAt)) {
        await prisma.userAchievement.deleteMany({ where: { id: row.id } });
        logger.info(
          `[ACH] recordUnlock: ach=${input.achievementId} for user=${input.userId} raced a reset; removed`,
        );
        return { created: false, beforeReset: true };
      }
      return { created: true, beforeReset: false };
    } catch (e) {
      // A concurrent writer may have inserted the row between our
      // findUnique and create (P2002 unique violation). That's the
      // idempotency guarantee doing its job — treat as "already
      // credited" rather than an error.
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        logger.info(
          `[ACH] recordUnlock: concurrent insert for user=${input.userId} ach=${input.achievementId} — treated as already unlocked`,
        );
        return { created: false, beforeReset: false };
      }
      throw e;
    }
  },
};
