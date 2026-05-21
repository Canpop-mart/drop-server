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
  resolveRACredentials,
  type RAGameInfo,
} from "~/server/internal/retroachievements";
import { achievementsRepo, unlocksRepo } from "./repo";
import type {
  AchievementDefinition,
  AchievementProvider,
  ScanResult,
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
  for (const [externalId, ach] of Object.entries(
    gameInfo.Achievements || {},
  )) {
    defs.push({
      externalId,
      title: ach.Title || externalId,
      description: ach.Description || "",
      iconUrl: ach.BadgeName ? `${RA_MEDIA}/${ach.BadgeName}.png` : "",
      iconLockedUrl: ach.BadgeName
        ? `${RA_MEDIA}/${ach.BadgeName}_lock.png`
        : "",
      displayOrder: order++,
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
   * unlocks via the canonical `unlocksRepo`. Shared by ra-poll and
   * session-end. Returns the count newly recorded.
   */
  async syncUnlocks(gameId, userId): Promise<{ newlyUnlocked: number }> {
    const link = await prisma.gameExternalLink.findUnique({
      where: {
        gameId_provider: {
          gameId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });
    if (!link) return { newlyUnlocked: 0 };

    // The user must have their OWN RA account linked — we query their
    // progress by username.
    const userRa = await prisma.userExternalAccount.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });
    if (!userRa || !userRa.externalId || !userRa.token) {
      logger.warn(`${LOG} syncUnlocks: user=${userId} has no RA account`);
      return { newlyUnlocked: 0 };
    }

    const creds = await resolveRACredentials(userId);
    if (!creds) return { newlyUnlocked: 0 };

    const client = createRAClient(creds.username, creds.apiKey);
    const raGameId = parseInt(link.externalGameId, 10);
    const progress = await client.getUserGameProgress(
      userRa.externalId,
      userRa.token,
      raGameId,
    );
    if (!progress || !progress.Achievements) {
      logger.warn(
        `${LOG} syncUnlocks: empty progress for user=${userRa.externalId} raGame=${raGameId}`,
      );
      return { newlyUnlocked: 0 };
    }

    const achievements = await prisma.achievement.findMany({
      where: { gameId, provider: ExternalAccountProvider.RetroAchievements },
    });
    const byExternalId = new Map(achievements.map((a) => [a.externalId, a]));

    let newlyUnlocked = 0;
    for (const [externalId, raAch] of Object.entries(progress.Achievements)) {
      if (!raAch.DateEarned && !raAch.DateEarnedHardcore) continue;
      const achievement = byExternalId.get(externalId);
      if (!achievement) continue;

      const occurredAt = new Date(
        raAch.DateEarned || raAch.DateEarnedHardcore || Date.now(),
      );
      const { created } = await unlocksRepo.recordUnlock({
        userId,
        achievementId: achievement.id,
        source: "ra-poll",
        occurredAt,
      });
      if (created) newlyUnlocked++;
    }

    if (newlyUnlocked > 0) {
      logger.info(
        `${LOG} syncUnlocks: ${newlyUnlocked} new unlock(s) for user=${userId} game=${gameId}`,
      );
    }
    return { newlyUnlocked };
  },

  async listDefinitions(gameId) {
    return achievementsRepo.listDefinitions(
      gameId,
      ExternalAccountProvider.RetroAchievements,
    );
  },
};
