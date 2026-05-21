import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  parseProviders,
  scanGame,
  type ProviderName,
  type ScanGameOutcome,
} from "~/server/internal/achievements";
import { logger } from "~/server/internal/logging";

/**
 * Canonical achievement scan endpoint.
 *
 * Replaces the old trio of `scan` / `scan-goldberg` / `scan-retroachievements`
 * (see docs/audit/achievements-2026.md — "Finding 1: duplicate scan
 * endpoints"). Every scan now routes through the
 * `server/internal/achievements` orchestrator.
 *
 * Body:
 *   - `provider`: "goldberg" | "retroachievements" | "both" (default "both")
 *   - `gameId`  : optional. When present, scans one game. When absent,
 *                 bulk-scans every game in the library.
 *
 * Per-provider failures are isolated by the orchestrator — a flaky Steam
 * API never blocks the RA pass and vice versa.
 *
 * The per-provider routes (`scan-goldberg`, `scan-retroachievements`) are
 * kept only as thin back-compat wrappers that call into this same code.
 */
const ScanRequest = type({
  "gameId?": "string",
  // Accept the new lowercase provider names plus the legacy capitalised
  // values the old admin UI sent, so an in-flight client doesn't break.
  "provider?":
    "'goldberg' | 'retroachievements' | 'both' | 'Goldberg' | 'RetroAchievements'",
}).configure(throwingArktype);

interface GameScanRow {
  gameId: string;
  gameName: string;
  outcomes: ScanGameOutcome[];
}

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ScanRequest);
  const providers: ProviderName[] = parseProviders(body.provider);
  if (providers.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Unknown provider — use goldberg, retroachievements or both.",
    });
  }

  // ── Single-game scan ───────────────────────────────────────────────
  if (body.gameId) {
    logger.info(
      `[ACH] scan: game=${body.gameId} providers=${providers.join("+")} userId=${userId}`,
    );
    const outcomes = await scanGame(body.gameId, providers, { userId });
    return {
      mode: "single" as const,
      gameId: body.gameId,
      outcomes,
    };
  }

  // ── Bulk scan — every game in the library ──────────────────────────
  logger.info(
    `[ACH] scan: BULK providers=${providers.join("+")} userId=${userId}`,
  );
  const games = await prisma.game.findMany({
    select: { id: true, mName: true, libraryPath: true },
  });

  const rows: GameScanRow[] = [];
  let totalLinked = 0;
  let totalDefinitions = 0;

  for (const game of games) {
    const outcomes = await scanGame(game.id, providers, { userId });
    const linkedHere = outcomes.some((o) => o.result.linked);
    if (linkedHere) totalLinked++;
    for (const o of outcomes) totalDefinitions += o.result.definitionCount;
    // Only include games where at least one provider produced something,
    // to keep the response small on large libraries.
    if (linkedHere || outcomes.some((o) => o.result.definitionCount > 0)) {
      rows.push({
        gameId: game.id,
        gameName: game.mName ?? game.libraryPath,
        outcomes,
      });
    }
  }

  logger.info(
    `[ACH] scan: BULK complete — ${games.length} game(s) scanned, ${totalLinked} linked, ${totalDefinitions} definition(s) written`,
  );

  return {
    mode: "bulk" as const,
    gamesScanned: games.length,
    gamesLinked: totalLinked,
    definitionsWritten: totalDefinitions,
    details: rows,
  };
});
