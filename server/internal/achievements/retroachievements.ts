/**
 * RetroAchievements achievement provider.
 *
 * Wraps the existing `RetroAchievementsClient` (server/internal/
 * retroachievements.ts) behind the shared `AchievementProvider`
 * interface and centralises two things that were copy-pasted across
 * four endpoints + a task before the 2026 audit:
 *
 *   - `raAchievementsToDefinitions` — the RA-API-row → AchievementDefinition
 *     mapping (badge URL construction lived inline in 4 places).
 *   - `scanGame` / `syncUnlocks` — definition refresh and per-user unlock
 *     polling, both funnelled through the canonical repos.
 */
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { logger } from "~/server/internal/logging";
import {
  createRAClient,
  parseRADate,
  resolveRACredentials,
  resolveRACredentialsForPlayer,
  type RAGameInfo,
} from "~/server/internal/retroachievements";
import { achievementsRepo, unlocksRepo } from "./repo";
import { isBeforeReset, resetsRepo } from "./reset";
import type {
  AchievementDefinition,
  AchievementProvider,
  ScanResult,
  UnlockSource,
} from "./types";

const LOG = "[ACH:ra]";
const RA_MEDIA = "https://media.retroachievements.org/Badge";

/**
 * Map RA's `Achievements` object (keyed by achievement ID) into our
 * provider-agnostic definitions. Badge URLs are raw RA CDN URLs — per
 * CLAUDE.md achievement icons are NOT proxied through the object store.
 */
export function raAchievementsToDefinitions(
  gameInfo: RAGameInfo,
): AchievementDefinition[] {
  const defs: AchievementDefinition[] = [];
  let order = 0;
  const players = gameInfo.NumDistinctPlayers ?? 0;
  for (const [externalId, ach] of Object.entries(gameInfo.Achievements || {})) {
    defs.push({
      externalId,
      title: ach.Title || externalId,
      description: ach.Description || "",
      iconUrl: ach.BadgeName ? `${RA_MEDIA}/${ach.BadgeName}.png` : "",
      iconLockedUrl: ach.BadgeName
        ? `${RA_MEDIA}/${ach.BadgeName}_lock.png`
        : "",
      displayOrder: order++,
      points: ach.Points ?? 0,
      globalPercent:
        players > 0 ? Math.min(100, (ach.NumAwarded / players) * 100) : null,
    });
  }
  return defs;
}

export const retroAchievementsProvider: AchievementProvider = {
  name: "RetroAchievements",

  async scanGame(gameId, opts): Promise<ScanResult> {
    const ctx = opts?.ctx;
    ctx?.markPhase?.("ra:resolve-creds");

    // An RA scan requires an existing link — the admin chooses the RA
    // game ID (manually or via the search UI) before scanning.
    const link = await prisma.gameExternalLink.findUnique({
      where: {
        gameId_provider: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });
    if (!link) {
      return {
        linked: false,
        definitionCount: 0,
        note: "No RetroAchievements link. Add the RA game ID first, then scan.",
      };
    }

    const creds = await resolveRACredentials(opts?.userId);
    if (!creds) {
      return {
        linked: true,
        externalGameId: link.externalGameId,
        definitionCount: 0,
        note: "No RetroAchievements credentials available (set RA_USERNAME/RA_API_KEY or link an account).",
      };
    }

    ctx?.markPhase?.("ra:fetch-definitions");
    const client = createRAClient(creds.username, creds.apiKey);
    const raGameId = parseInt(link.externalGameId, 10);
    const gameInfo = await client.getGameAchievements(raGameId);
    if (!gameInfo) {
      return {
        linked: true,
        externalGameId: link.externalGameId,
        definitionCount: 0,
        note: `Failed to fetch achievements from RetroAchievements for game ${raGameId}.`,
      };
    }

    ctx?.markPhase?.("ra:write-definitions");
    const defs = raAchievementsToDefinitions(gameInfo);
    const written = await achievementsRepo.upsertDefinitions(
      gameId,
      ExternalAccountProvider.RetroAchievements,
      defs,
    );

    logger.info(
      `${LOG} scanGame: game=${gameId} raGame=${raGameId} definitions=${written}`,
    );
    return {
      linked: true,
      externalGameId: link.externalGameId,
      definitionCount: written,
      note: `Scanned RA game ${raGameId} — ${written} definition(s).`,
    };
  },

  /**
   * Poll RA for a user's unlock state for one game and record any new
   * unlocks via the canonical `unlocksRepo`. Used by session-end; ra-poll
   * calls `syncRAUnlocksForUser` directly because it needs the unlock list.
   * Returns the count newly recorded.
   */
  async syncUnlocks(gameId, userId, opts): Promise<{ newlyUnlocked: number }> {
    const result = await syncRAUnlocksForUser(
      gameId,
      userId,
      opts?.source ?? "session-end",
    );
    return { newlyUnlocked: result.unlocked.length };
  },
};

/** Why an RA sync recorded nothing, when it didn't get as far as RA. */
export type RASyncSkipReason =
  | "no_link"
  | "no_account"
  | "no_credentials"
  | "empty_progress";

export interface RARecordedUnlock {
  id: string;
  externalId: string;
  title: string;
  description: string;
  iconUrl: string;
}

export interface RASyncResult {
  /** Set when the sync stopped before reading the player's progress. */
  skipped?: RASyncSkipReason;
  /** Unlocks this call recorded for the first time. */
  unlocked: RARecordedUnlock[];
  /** Unlocks RA reports that predate the player's reset, so were ignored. */
  ignoredBeforeReset: number;
}

/**
 * Reads a player's RetroAchievements progress for one game and records any
 * unlock the server doesn't have yet. Shared by ra-poll (mid-session) and
 * session-end.
 *
 * Only the player's RA USERNAME is needed when the server has its own
 * RA_USERNAME / RA_API_KEY; otherwise the player's own linked Web API key is
 * used. Never another player's key (see `resolveRACredentialsForPlayer`).
 */
export async function syncRAUnlocksForUser(
  gameId: string,
  userId: string,
  source: UnlockSource,
): Promise<RASyncResult> {
  const link = await prisma.gameExternalLink.findUnique({
    where: {
      gameId_provider: {
        gameId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
  });
  if (!link) return { skipped: "no_link", unlocked: [], ignoredBeforeReset: 0 };

  const userRa = await prisma.userExternalAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
  });
  if (!userRa || !userRa.externalId) {
    logger.warn(`${LOG} sync: user=${userId} has no RA account linked`);
    return { skipped: "no_account", unlocked: [], ignoredBeforeReset: 0 };
  }

  const creds = await resolveRACredentialsForPlayer(userId);
  if (!creds) {
    logger.warn(
      `${LOG} sync: no RA Web API credentials for user=${userId} ` +
        `(set RA_USERNAME/RA_API_KEY on the server, or link with an API key)`,
    );
    return { skipped: "no_credentials", unlocked: [], ignoredBeforeReset: 0 };
  }

  const client = createRAClient(creds.username, creds.apiKey);
  const raGameId = parseInt(link.externalGameId, 10);
  // The second argument is unused by the client (progress is read with the
  // admin credentials above plus the player's username); kept for its
  // signature.
  const progress = await client.getUserGameProgress(
    userRa.externalId,
    userRa.token,
    raGameId,
  );
  if (!progress || !progress.Achievements) {
    logger.warn(
      `${LOG} sync: empty progress for user=${userRa.externalId} raGame=${raGameId}`,
    );
    return { skipped: "empty_progress", unlocked: [], ignoredBeforeReset: 0 };
  }

  const achievements = await prisma.achievement.findMany({
    where: { gameId, provider: ExternalAccountProvider.RetroAchievements },
  });
  const byExternalId = new Map(achievements.map((a) => [a.externalId, a]));
  const resetAt = await resetsRepo.getResetAt(userId, gameId);
  // One query for what is already credited, so a poll every 15s doesn't
  // cost a lookup per earned achievement.
  const existing = await prisma.userAchievement.findMany({
    where: {
      userId,
      achievementId: { in: achievements.map((a) => a.id) },
    },
    select: { achievementId: true },
  });
  const alreadyUnlocked = new Set(existing.map((e) => e.achievementId));

  const unlocked: RARecordedUnlock[] = [];
  let ignoredBeforeReset = 0;
  for (const [externalId, raAch] of Object.entries(progress.Achievements)) {
    const earnedRaw = raAch.DateEarned || raAch.DateEarnedHardcore;
    if (!earnedRaw) continue;
    const achievement = byExternalId.get(externalId);
    if (!achievement || alreadyUnlocked.has(achievement.id)) continue;

    // No parseable date: treat as earned now. That is after any reset, so
    // it is recorded, which is the lesser evil next to losing a real unlock.
    const occurredAt = parseRADate(earnedRaw) ?? new Date();
    // Pre-filter: RA reports every pre-reset unlock on every 15s poll, and
    // each would otherwise cost recordUnlock's lookups.
    if (isBeforeReset(occurredAt, resetAt)) {
      ignoredBeforeReset++;
      continue;
    }
    const { created, beforeReset } = await unlocksRepo.recordUnlock(
      {
        userId,
        gameId,
        achievementId: achievement.id,
        source,
        occurredAt,
      },
      { resetAt },
    );
    if (beforeReset) ignoredBeforeReset++;
    if (!created) continue;
    unlocked.push({
      id: achievement.id,
      externalId: achievement.externalId,
      title: achievement.title,
      description: achievement.description ?? "",
      iconUrl: achievement.iconUrl ?? "",
    });
  }

  if (unlocked.length > 0) {
    logger.info(
      `${LOG} sync (${source}): ${unlocked.length} new unlock(s) for user=${userId} game=${gameId}`,
    );
  }
  if (ignoredBeforeReset > 0) {
    logger.debug(
      `${LOG} sync (${source}): ignored ${ignoredBeforeReset} unlock(s) earned before ` +
        `user=${userId} reset game=${gameId}`,
    );
  }
  return { unlocked, ignoredBeforeReset };
}
