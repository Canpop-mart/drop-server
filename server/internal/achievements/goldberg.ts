/**
 * Goldberg achievement provider.
 *
 * Thin adapter that exposes the existing Goldberg machinery
 * (`server/internal/goldberg.ts`) through the shared `AchievementProvider`
 * interface. The heavy lifting — DLL swap, steam_settings/ scaffolding,
 * Steam API fallback, manifest regen — stays in `goldberg.ts` because the
 * import pipeline (`server/internal/library/import/setupEmulators.ts`)
 * imports `setupGoldberg` directly and moving it would ripple through 10
 * call sites. See docs/audit/achievements-2026.md ("Decision: goldberg.ts
 * stays put").
 *
 * What this file adds: a provider object whose `scanGame` runs the same
 * `setupGoldberg` pipeline, and `listDefinitions` reads back via the
 * canonical `achievementsRepo`.
 */
import {
  resolveGameVersionDir,
  setupGoldberg,
} from "~/server/internal/goldberg";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { logger } from "~/server/internal/logging";
import { achievementsRepo } from "./repo";
import type { AchievementProvider, ScanResult } from "./types";

const LOG = "[ACH:goldberg]";

export const goldbergProvider: AchievementProvider = {
  name: "Goldberg",

  async scanGame(gameId, opts): Promise<ScanResult> {
    const ctx = opts?.ctx;
    ctx?.markPhase?.("goldberg:resolve-dir");

    const versionDir = await resolveGameVersionDir(gameId);
    if (!versionDir) {
      logger.warn(
        `${LOG} scanGame: cannot resolve version dir for game=${gameId} (not filesystem-backed?)`,
      );
      return {
        linked: false,
        definitionCount: 0,
        note: "No filesystem version directory — cannot scan Goldberg.",
      };
    }

    // setupGoldberg owns the whole pipeline: local achievements.json →
    // Steam API fallback → write to disk → DB upsert → external link.
    // It already writes Achievement rows itself; the audit keeps that
    // (it's the import-time write path) but `setupGoldberg` now shares
    // the same upsert shape as achievementsRepo so the records match.
    ctx?.markPhase?.("goldberg:setup");
    await setupGoldberg(gameId, versionDir, {
      logger: ctx?.logger ?? logger,
    });

    ctx?.markPhase?.("goldberg:count");
    const link = await prisma.gameExternalLink.findUnique({
      where: {
        gameId_provider: {
          gameId,
          provider: ExternalAccountProvider.Goldberg,
        },
      },
      select: { externalGameId: true },
    });
    const definitionCount = await prisma.achievement.count({
      where: { gameId, provider: ExternalAccountProvider.Goldberg },
    });

    logger.info(
      `${LOG} scanGame: game=${gameId} appId=${link?.externalGameId ?? "n/a"} definitions=${definitionCount}`,
    );

    return {
      linked: !!link,
      externalGameId: link?.externalGameId,
      definitionCount,
      note: link
        ? `Linked to Steam AppID ${link.externalGameId}`
        : "No Goldberg link could be resolved.",
    };
  },

  // Goldberg unlocks are pushed by the desktop client (it reads the
  // local save file and POSTs to achievements-report). There is nothing
  // server-side to poll, so this is a deliberate no-op.
  async syncUnlocks(): Promise<{ newlyUnlocked: number }> {
    return { newlyUnlocked: 0 };
  },

  async listDefinitions(gameId) {
    return achievementsRepo.listDefinitions(
      gameId,
      ExternalAccountProvider.Goldberg,
    );
  },
};
