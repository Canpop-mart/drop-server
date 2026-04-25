import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import type { GameCompatibilityStatus, Platform } from "~/prisma/client/enums";

/**
 * Returns the best compat status per (game, platform) across all clients
 * the calling user owns. Used by the library UI to render badges next to
 * each game showing "this works on Windows / this is broken on Linux".
 *
 * "Best" status priority (highest first):
 *   AliveRenders > AliveNoRender > EarlyExit > Crash > NoLaunch > InstallFailed
 *
 * Returns an object keyed by gameId, each containing per-platform entries
 * with the latest result's status, signature, and a timestamp.
 *
 * Implementation note: the user-library lookup happens via the User → Client
 * → CompatibilityResult chain, so a Client belonging to another user can't
 * leak its results to this user.
 */

const STATUS_RANK: Record<GameCompatibilityStatus, number> = {
  AliveRenders: 100,
  AliveNoRender: 80,
  EarlyExit: 60,
  Crash: 50,
  NoLaunch: 30,
  InstallFailed: 20,
  Installing: 10,
  Testing: 10,
  Untested: 0,
};

type PlatformResult = {
  status: GameCompatibilityStatus;
  signature: string | null;
  protonVersion: string | null;
  testedAt: string;
};

export default defineClientEventHandler(async (_h3, { fetchUser }) => {
  const user = await fetchUser();

  // Pull every result belonging to a client owned by this user.
  // We need the join through Client to know the platform AND to enforce
  // the user-ownership boundary.
  const rows = await prisma.gameCompatibilityResult.findMany({
    where: {
      client: { userId: user.id },
    },
    select: {
      gameId: true,
      status: true,
      signature: true,
      protonVersion: true,
      testedAt: true,
      client: {
        select: { platform: true },
      },
    },
    orderBy: { testedAt: "desc" },
  });

  // Aggregate: for each (gameId, platform) keep the best result, breaking
  // ties by most-recent.
  const byGame = new Map<string, Partial<Record<Platform, PlatformResult>>>();
  const bestRank = new Map<string, number>(); // key: gameId|platform

  for (const row of rows) {
    const key = `${row.gameId}|${row.client.platform}`;
    const rank = STATUS_RANK[row.status] ?? 0;
    const existingRank = bestRank.get(key) ?? -1;

    // Strict > so most-recent wins ties (rows are already sorted desc by testedAt).
    if (rank <= existingRank) continue;

    bestRank.set(key, rank);
    let perPlatform = byGame.get(row.gameId);
    if (!perPlatform) {
      perPlatform = {};
      byGame.set(row.gameId, perPlatform);
    }
    perPlatform[row.client.platform] = {
      status: row.status,
      signature: row.signature,
      protonVersion: row.protonVersion,
      testedAt: row.testedAt.toISOString(),
    };
  }

  // Flat object response for trivial JSON serialization.
  const out: Record<string, Partial<Record<Platform, PlatformResult>>> = {};
  for (const [gameId, platforms] of byGame) {
    out[gameId] = platforms;
  }
  return out;
});
