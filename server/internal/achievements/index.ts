/**
 * Achievement subsystem — public entrypoint.
 *
 * Exposes the provider registry and the `scanGames` orchestrator that
 * every admin scan endpoint funnels through. See
 * docs/audit/achievements-2026.md.
 *
 * Layout (introduced by the 2026 audit):
 *   - types.ts            — AchievementProvider interface + shared types
 *   - repo.ts             — achievementsRepo / unlocksRepo (canonical writes)
 *   - goldberg.ts         — Goldberg provider (adapter over server/internal/goldberg.ts)
 *   - retroachievements.ts — RetroAchievements provider
 *   - index.ts            — this file: registry + scan orchestrator
 *
 * NOTE: `server/internal/goldberg.ts` deliberately stays where it is —
 * the import pipeline imports `setupGoldberg` from it directly and the
 * coupling made an in-place move risky mid-refactor. The provider
 * interface still wraps it cleanly. Documented in the audit doc.
 */
import type { TaskRunContext } from "~/server/internal/tasks";
import { logger } from "~/server/internal/logging";
import { goldbergProvider } from "./goldberg";
import { retroAchievementsProvider } from "./retroachievements";
import type { AchievementProvider, ScanResult } from "./types";

export type ProviderName = "goldberg" | "retroachievements";

/** The provider registry — keyed by lowercase name for endpoint params. */
const REGISTRY: Record<ProviderName, AchievementProvider> = {
  goldberg: goldbergProvider,
  retroachievements: retroAchievementsProvider,
};

/** All providers, for "scan everything" flows. */
export const allProviders: AchievementProvider[] = Object.values(REGISTRY);

/** Normalise a free-form query value to a ProviderName list. */
export function parseProviders(value: string | undefined): ProviderName[] {
  const v = (value ?? "both").toLowerCase();
  if (v === "both" || v === "all") return ["goldberg", "retroachievements"];
  if (v === "goldberg") return ["goldberg"];
  if (v === "retroachievements" || v === "ra") return ["retroachievements"];
  return [];
}

export interface ScanGameOutcome {
  provider: ProviderName;
  result: ScanResult;
}

/**
 * Scan ONE game across the requested providers. This is the single
 * orchestrator behind every admin scan endpoint — per-game scans pass a
 * `gameId`, the bulk endpoint loops and calls this per game.
 *
 * Each provider failure is isolated: a Steam API hiccup on the Goldberg
 * scan never blocks the RA scan and vice versa.
 */
export async function scanGame(
  gameId: string,
  providers: ProviderName[],
  opts?: { userId?: string; ctx?: TaskRunContext },
): Promise<ScanGameOutcome[]> {
  const outcomes: ScanGameOutcome[] = [];
  for (const name of providers) {
    const provider = REGISTRY[name];
    if (!provider) continue;
    try {
      const result = await provider.scanGame(gameId, opts);
      outcomes.push({ provider: name, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(
        `[ACH] scanGame: provider=${name} failed for game=${gameId}: ${msg}`,
      );
      outcomes.push({
        provider: name,
        result: {
          linked: false,
          definitionCount: 0,
          note: `Scan failed: ${msg}`,
        },
      });
    }
  }
  return outcomes;
}

export { achievementsRepo, unlocksRepo } from "./repo";
export type {
  AchievementProvider,
  AchievementDefinition,
  ScanResult,
  UnlockInput,
  UnlockSource,
} from "./types";
