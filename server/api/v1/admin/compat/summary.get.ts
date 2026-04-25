import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Admin overview of compatibility test coverage across the library.
 *
 * Returns:
 *   - Overall counts grouped by (platform, status) — the histogram you'd
 *     skim to see "how many games crash on Linux vs Windows".
 *   - Top crash signatures, so a single fix that resolves N games becomes
 *     visible at a glance.
 *   - Untested count: total games minus games with any result on this client.
 *
 * Reuses `library:read` since this is fundamentally library metadata. If
 * compat scanning ever becomes a separately-gated capability we can split
 * the ACL.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["library:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  // Histogram: how many results in each (platform, status) bucket.
  // We aggregate at the DB level rather than pulling all rows.
  const histogram = await prisma.$queryRaw<
    Array<{ platform: string; status: string; count: bigint }>
  >`
    SELECT c."platform"::text AS platform,
           r."status"::text   AS status,
           COUNT(DISTINCT r."gameId")::bigint AS count
    FROM "GameCompatibilityResult" r
    JOIN "Client" c ON c."id" = r."clientId"
    -- Only the latest result per (gameId, clientId) counts toward "current state"
    WHERE r."testedAt" = (
      SELECT MAX(r2."testedAt")
      FROM "GameCompatibilityResult" r2
      WHERE r2."gameId" = r."gameId" AND r2."clientId" = r."clientId"
    )
    GROUP BY c."platform", r."status"
    ORDER BY c."platform", r."status"
  `;

  // Top crash signatures — failures that share a fingerprint are usually one
  // root cause, so this guides where to focus a fix.
  const topSignatures = await prisma.gameCompatibilityResult.groupBy({
    by: ["signature", "status"],
    where: {
      status: { in: ["Crash", "EarlyExit"] },
      signature: { not: null },
    },
    _count: { gameId: true },
    orderBy: { _count: { gameId: "desc" } },
    take: 10,
  });

  const totalGames = await prisma.game.count();
  const testedGames = await prisma.gameCompatibilityResult
    .findMany({
      distinct: ["gameId"],
      select: { gameId: true },
    })
    .then((r) => r.length);

  return {
    totalGames,
    testedGames,
    untestedGames: totalGames - testedGames,
    histogram: histogram.map((r) => ({
      platform: r.platform,
      status: r.status,
      count: Number(r.count), // BigInt → number for JSON
    })),
    topSignatures: topSignatures.map((r) => ({
      signature: r.signature,
      status: r.status,
      gameCount: r._count.gameId,
    })),
  };
});
