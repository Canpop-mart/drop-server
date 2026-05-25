import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * "Spin to pick" — returns ONE random game from a prioritized pool so the
 * front-end can power a roulette-style discovery widget.
 *
 * Priority order (first non-empty pool wins):
 *   1. `rediscovery` — games the caller has installed on at least one client
 *      but hasn't played (no Playtime row, or last updatedAt > 14 days ago).
 *   2. `library`     — any game the caller has installed (regardless of
 *                       recent play). The "I just feel like *something* from
 *                       my library" bucket.
 *   3. `social`      — games on this server's store that ≥ 2 OTHER users
 *                       (i.e. not the caller) have actually played, weighted
 *                       toward broader social proof. Caller doesn't need to
 *                       own them; that's the whole point of the bucket.
 *
 * Returns null when every pool is empty, so the UI can decide whether to
 * show an empty state or hide the widget entirely.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const REDISCOVERY_THRESHOLD_DAYS = 14;
  const rediscoveryCutoff = new Date(
    Date.now() - REDISCOVERY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );

  // ── 1. Resolve the caller's installed-game set ─────────────────────────────
  // ClientInstalledGame is keyed by client device, not user, so we pull every
  // client owned by the caller and union their installed game ids.
  const callerClients = await prisma.client.findMany({
    where: { userId },
    select: { id: true },
  });
  const callerClientIds = callerClients.map((c) => c.id);

  const installedRows =
    callerClientIds.length > 0
      ? await prisma.clientInstalledGame.findMany({
          where: { clientId: { in: callerClientIds } },
          select: { gameId: true },
        })
      : [];
  const installedGameIds = [...new Set(installedRows.map((r) => r.gameId))];

  // ── 2. Build the prioritized candidate pool ────────────────────────────────
  let pickGameId: string | null = null;
  let source: "rediscovery" | "library" | "social" | null = null;

  if (installedGameIds.length > 0) {
    // 1: rediscovery — installed games whose Playtime row (per caller) is
    // either missing or hasn't been touched in > 14 days.
    const recentPlaytimes = await prisma.playtime.findMany({
      where: {
        userId,
        gameId: { in: installedGameIds },
        updatedAt: { gte: rediscoveryCutoff },
      },
      select: { gameId: true },
    });
    const recentlyPlayedSet = new Set(recentPlaytimes.map((p) => p.gameId));

    const rediscoveryPool = installedGameIds.filter(
      (gid) => !recentlyPlayedSet.has(gid),
    );

    if (rediscoveryPool.length > 0) {
      pickGameId =
        rediscoveryPool[Math.floor(Math.random() * rediscoveryPool.length)];
      source = "rediscovery";
    } else {
      // 2: library — anything the caller has installed.
      pickGameId =
        installedGameIds[Math.floor(Math.random() * installedGameIds.length)];
      source = "library";
    }
  } else {
    // 3: social — games ≥ 2 OTHER users have played. We use the Playtime
    // table (cumulative per user/game) rather than PlaySession so a single
    // active player doesn't inflate the count.
    //
    // We group by gameId and count distinct contributing userIds, then
    // filter in JS to keep the query simple and portable across Prisma
    // versions — `having` on aggregates exists but is finicky to type, and
    // the result set here is bounded by the server's game catalog anyway.
    const socialRows = await prisma.playtime.groupBy({
      by: ["gameId"],
      where: {
        userId: { not: userId },
        seconds: { gt: 0 },
      },
      _count: { userId: true },
    });
    const socialGameIds = socialRows
      .filter((r) => (r._count?.userId ?? 0) >= 2)
      .map((r) => r.gameId);

    if (socialGameIds.length > 0) {
      pickGameId =
        socialGameIds[Math.floor(Math.random() * socialGameIds.length)];
      source = "social";
    }
  }

  if (!pickGameId || !source) return null;

  // ── 3. Hydrate the chosen game ─────────────────────────────────────────────
  const game = await prisma.game.findUnique({
    where: { id: pickGameId },
    select: {
      id: true,
      mName: true,
      mCoverObjectId: true,
      mBannerObjectId: true,
    },
  });
  if (!game) return null; // Race: game removed between pick and hydrate.

  const payload: {
    game: {
      id: string;
      name: string;
      coverObjectId: string | null;
      bannerObjectId: string | null;
    };
    source: "rediscovery" | "library" | "social";
    alsoPlayedBy?: Array<{
      userId: string;
      displayName: string;
      avatarObjectId: string | null;
    }>;
  } = {
    game: {
      id: game.id,
      name: game.mName,
      coverObjectId: game.mCoverObjectId || null,
      bannerObjectId: game.mBannerObjectId || null,
    },
    source,
  };

  // ── 4. For social picks, surface up to 5 players for the caption ──────────
  if (source === "social") {
    const otherPlayers = await prisma.playtime.findMany({
      where: {
        gameId: pickGameId,
        userId: { not: userId },
        seconds: { gt: 0 },
      },
      orderBy: { seconds: "desc" },
      take: 5,
      select: { userId: true },
    });
    const otherUserIds = otherPlayers.map((p) => p.userId);
    if (otherUserIds.length > 0) {
      const users = await prisma.user.findMany({
        where: {
          id: { in: otherUserIds },
          enabled: true,
          username: { not: "system" },
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          profilePictureObjectId: true,
        },
      });
      payload.alsoPlayedBy = users.map((u) => ({
        userId: u.id,
        displayName: u.displayName || u.username,
        avatarObjectId: u.profilePictureObjectId || null,
      }));
    }
  }

  return payload;
});
