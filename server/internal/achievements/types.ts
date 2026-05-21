/**
 * Achievement subsystem — shared types.
 *
 * Introduced by the 2026 achievements audit (docs/audit/achievements-2026.md).
 * Before this, Goldberg and RetroAchievements each had their own ad-hoc
 * scan/write code scattered across `server/internal/goldberg.ts`,
 * `server/internal/retroachievements.ts`, four admin endpoints and three
 * task files. This module gives both a single `AchievementProvider`
 * shape plus canonical write paths (`achievementsRepo`, `unlocksRepo`).
 */
import type { ExternalAccountProvider } from "~/prisma/client/enums";
import type { TaskRunContext } from "~/server/internal/tasks";

/**
 * A provider-agnostic achievement definition. Both Goldberg's
 * `steam_settings/achievements.json` entries and RetroAchievements'
 * API rows are normalised into this before hitting the DB.
 */
export interface AchievementDefinition {
  /** Provider-native stable ID — Steam API name or RA achievement ID. */
  externalId: string;
  title: string;
  description: string;
  /** Raw CDN URL (Steam / RA media host). NOT proxied through objectHandler. */
  iconUrl: string;
  /** Raw CDN URL for the locked/greyed variant. */
  iconLockedUrl: string;
  /** Sort order within the game, provider-defined. */
  displayOrder: number;
}

/** Result of a per-game definition scan. */
export interface ScanResult {
  /** True when the game was matched / had a usable link. */
  linked: boolean;
  /** External game ID resolved for this provider (Steam AppID / RA game ID). */
  externalGameId?: string;
  /** Number of achievement definitions written. */
  definitionCount: number;
  /** Human-readable note for the admin UI (skip reason, match name, …). */
  note?: string;
}

/**
 * Where a recorded unlock came from. Stored on UserAchievement.source for
 * diagnostics. Does NOT affect idempotency — see unlocksRepo.recordUnlock.
 */
export type UnlockSource = "client-report" | "ra-poll" | "session-end";

/** A single unlock to be persisted. */
export interface UnlockInput {
  userId: string;
  achievementId: string;
  source: UnlockSource;
  occurredAt: Date;
}

/**
 * Common surface every achievement provider implements. Keeps the scan
 * orchestrator and admin endpoints decoupled from Goldberg/RA specifics.
 *
 * `scanGame` writes definitions for one game; `listDefinitions` is the
 * read side; `syncUnlocks` pulls a user's unlock state from the provider
 * (only RA implements a meaningful version — Goldberg unlocks are pushed
 * by the client, so its `syncUnlocks` is a no-op).
 */
export interface AchievementProvider {
  /** Stable provider key, matches the Prisma ExternalAccountProvider enum. */
  readonly name: Extract<
    ExternalAccountProvider,
    "Goldberg" | "RetroAchievements"
  >;

  /**
   * Resolve + persist achievement definitions for a single game.
   * Implementations must go through `achievementsRepo.upsertDefinitions`
   * so the write path stays canonical.
   */
  scanGame(
    gameId: string,
    opts?: { userId?: string; ctx?: TaskRunContext },
  ): Promise<ScanResult>;

  /**
   * Pull a user's unlock state from the provider and record any new
   * unlocks via `unlocksRepo.recordUnlock`. Returns the count newly
   * recorded. Goldberg returns 0 (its unlocks come via client reports).
   */
  syncUnlocks(
    gameId: string,
    userId: string,
  ): Promise<{ newlyUnlocked: number }>;

  /** Read achievement definitions currently stored for a game. */
  listDefinitions(gameId: string): Promise<AchievementDefinition[]>;
}
