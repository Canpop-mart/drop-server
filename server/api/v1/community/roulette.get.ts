import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { GameType } from "~/prisma/client/enums";

/**
 * "Spin to pick" — returns ONE random game from a weighted pool of EVERY
 * game on the Drop store, so the wheel can land on something the caller
 * has never seen as well as anything from their own library.
 *
 * Selection:
 *   • Base pool = every Game row on the server (weight 1)
 *   • + caller's installs (weight 2 total — base 1 plus an extra entry)
 *   • + caller's cold installs (weight 4 total — installed but not played
 *     in > 14 days; gets +2 more on top of the install entry)
 *   • `source` on the response reflects which bucket the chosen game came
 *     from: `rediscovery` / `library` / `discover` / `social`.
 *   • `social` is the legacy fallback when the catalog is empty AND the
 *     caller has nothing installed; in practice on a populated server
 *     this branch is dead, but it stays as a defensive fallback.
 *
 * For `social` and `discover` picks we additionally surface up to 5
 * other server users who have hours in the game, so the caption can
 * read "3 friends play this" instead of just announcing the title.
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

  // ── 2. Build the candidate pool ────────────────────────────────────────────
  let pickGameId: string | null = null;
  let source: "rediscovery" | "library" | "social" | "discover" | null = null;

  // Pool composition (per the user's "let me discover anything" request):
  //   • EVERY game on the Drop store gets weight 1 — the wheel can land on
  //     a game the caller has never seen.
  //   • Caller's installs get +1 weight (total 2× the catalog base).
  //   • Caller's cold installs (rediscovery — installed but not played in
  //     > 14 days) get +2 more on top (total 4×).
  // The old logic short-circuited on the rediscovery pool whenever it was
  // non-empty, which produced "always the same game" — typically an
  // emulator launcher the user has technically installed but never opens
  // directly, while every actual game has been played in the last fortnight.
  const allGames = await prisma.game.findMany({
    where: { type: GameType.Game },
    select: { id: true },
  });
  const allGameIds = allGames.map((g) => g.id);

  if (allGameIds.length > 0) {
    let rediscoveryPool: string[] = [];
    if (installedGameIds.length > 0) {
      const recentPlaytimes = await prisma.playtime.findMany({
        where: {
          userId,
          gameId: { in: installedGameIds },
          updatedAt: { gte: rediscoveryCutoff },
        },
        select: { gameId: true },
      });
      const recentlyPlayedSet = new Set(recentPlaytimes.map((p) => p.gameId));
      rediscoveryPool = installedGameIds.filter(
        (gid) => !recentlyPlayedSet.has(gid),
      );
    }

    const weightedPool: string[] = [...allGameIds];
    weightedPool.push(...installedGameIds);
    weightedPool.push(...rediscoveryPool, ...rediscoveryPool);

    pickGameId = weightedPool[Math.floor(Math.random() * weightedPool.length)];

    if (rediscoveryPool.includes(pickGameId)) {
      source = "rediscovery";
    } else if (installedGameIds.includes(pickGameId)) {
      source = "library";
    } else {
      source = "discover";
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
    source: "rediscovery" | "library" | "social" | "discover";
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

  // ── 4. For social / discover picks, surface up to 5 players who've put
  // hours into this game (excluding the caller). The discover branch may
  // land on a game the caller has never seen; if other users on the server
  // have played it, that's the most useful caption ("3 friends play this")
  // — so we run the same enrichment as the legacy social branch.
  if (source === "social" || source === "discover") {
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
