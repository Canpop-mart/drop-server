import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Weekly recap — up to 5 highlight cards covering the last 7 days. Each card
 * is a structured slide the front-end renders in a carousel:
 *
 *   { kind, title, headline, meta, gameId, userId, coverObjectId, avatarObjectId }
 *
 * The split lets the UI build a real hierarchy (kicker / headline / meta line)
 * with a thumbnail anchor on the left, instead of forcing every kind through
 * a flat "subtitle joined with bullets" string.
 *
 *  - title           The kicker label ("MOST PLAYED THIS WEEK")
 *  - headline        The big bolded line — what the slide is *about*
 *                    (game name for top_game; player name for the rest)
 *  - meta            The quieter supporting line (durations, counts, etc.)
 *  - coverObjectId   Game cover for the thumbnail slot
 *  - avatarObjectId  Player avatar — used when no game cover is in scope
 *
 * Slide kinds (all optional — skip if no qualifying data):
 *  - top_game        max(SUM(durationSeconds)) grouped by gameId
 *  - longest_session max(durationSeconds) across sessions
 *  - most_unlocks    max(COUNT(*)) of achievement unlocks grouped by userId
 *  - milestone       first user to cross a 25/50/100/250h lifetime threshold
 *                    inside the window
 *  - new_player      a user whose very first session fell within the window
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - WEEK_MS);

  // Both of these were unbounded, so a busy week could pull the whole session
  // table into memory to render five slides. Ordered so the cap drops the rows
  // that matter least: the shortest sessions and the oldest unlocks.
  const SESSION_LIMIT = 5000;
  const ACHIEVEMENT_LIMIT = 5000;

  // Sessions inside the window. We require durationSeconds so we can sum
  // and rank meaningfully — still-running sessions show up next week.
  const sessions = await prisma.playSession.findMany({
    where: {
      startedAt: { gte: since },
      durationSeconds: { not: null, gt: 0 },
    },
    select: {
      userId: true,
      gameId: true,
      startedAt: true,
      durationSeconds: true,
    },
    orderBy: { durationSeconds: "desc" },
    take: SESSION_LIMIT,
  });

  const achievements = await prisma.userAchievement.findMany({
    where: { unlockedAt: { gte: since } },
    select: { userId: true },
    orderBy: { unlockedAt: "desc" },
    take: ACHIEVEMENT_LIMIT,
  });

  type Slide = {
    kind:
      | "top_game"
      | "longest_session"
      | "milestone"
      | "new_player"
      | "most_unlocks";
    title: string;
    headline: string;
    meta: string;
    gameId: string | null;
    userId: string | null;
    coverObjectId: string | null;
    avatarObjectId: string | null;
  };

  const slides: Slide[] = [];

  // ── Aggregate helpers ────────────────────────────────────────────────────
  const gameTotals = new Map<string, number>();
  const gamePlayers = new Map<string, Set<string>>();
  let longestSession: (typeof sessions)[number] | null = null;

  for (const s of sessions) {
    const dur = s.durationSeconds ?? 0;
    gameTotals.set(s.gameId, (gameTotals.get(s.gameId) ?? 0) + dur);
    if (!gamePlayers.has(s.gameId)) gamePlayers.set(s.gameId, new Set());
    gamePlayers.get(s.gameId)!.add(s.userId);

    if (!longestSession || dur > (longestSession.durationSeconds ?? 0)) {
      longestSession = s;
    }
  }

  const achievementsByUser = new Map<string, number>();
  for (const a of achievements) {
    achievementsByUser.set(
      a.userId,
      (achievementsByUser.get(a.userId) ?? 0) + 1,
    );
  }

  // Pre-fetch every referenced user + game in one shot. We filter out the
  // system user here so any aggregate that happens to land on it is dropped
  // when we look up its row below.
  const referencedUserIds = new Set<string>();
  const referencedGameIds = new Set<string>();
  for (const id of achievementsByUser.keys()) referencedUserIds.add(id);
  for (const set of gamePlayers.values())
    for (const uid of set) referencedUserIds.add(uid);
  for (const id of gameTotals.keys()) referencedGameIds.add(id);
  if (longestSession) {
    referencedUserIds.add(longestSession.userId);
    referencedGameIds.add(longestSession.gameId);
  }

  // The milestone and new-player slides need these two, and neither depends on
  // the user/game lookups, so they ride along in the same round trip instead of
  // waiting their turn further down. They key by userId, so covering every
  // session author (rather than only the ones that survive the enabled/system
  // filter below) just means a couple of unused entries.
  const allSessionUserIds = [...new Set(sessions.map((s) => s.userId))];

  const [users, games, lifetimeRows, olderSessions] = await Promise.all([
    referencedUserIds.size > 0
      ? prisma.user.findMany({
          where: {
            id: { in: [...referencedUserIds] },
            enabled: true,
            username: { not: "system" },
          },
          select: {
            id: true,
            displayName: true,
            username: true,
            profilePictureObjectId: true,
          },
        })
      : [],
    referencedGameIds.size > 0
      ? prisma.game.findMany({
          where: { id: { in: [...referencedGameIds] } },
          select: { id: true, mName: true, mCoverObjectId: true },
        })
      : [],
    // Lifetime seconds per user, for the milestone slide.
    allSessionUserIds.length > 0
      ? prisma.playtime.groupBy({
          by: ["userId"],
          where: { userId: { in: allSessionUserIds } },
          _sum: { seconds: true },
        })
      : [],
    // Anyone with a session before the window is not new, for the new-player slide.
    allSessionUserIds.length > 0
      ? prisma.playSession.findMany({
          where: {
            userId: { in: allSessionUserIds },
            startedAt: { lt: since },
          },
          select: { userId: true },
          distinct: ["userId"],
        })
      : [],
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const gameMap = new Map(games.map((g) => [g.id, g]));

  const displayName = (uid: string) =>
    userMap.get(uid)?.displayName ?? userMap.get(uid)?.username ?? "Someone";
  const userAvatar = (uid: string) =>
    userMap.get(uid)?.profilePictureObjectId || null;
  const gameCover = (gid: string) => gameMap.get(gid)?.mCoverObjectId || null;
  const formatHours = (seconds: number) => {
    const hours = seconds / 3600;
    if (hours >= 1) {
      const rounded = Math.round(hours * 10) / 10;
      return `${rounded} hours`;
    }
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  };

  // ── Slide: top game by total playtime ────────────────────────────────────
  // The GAME is the news here — the headline is its name, the meta line
  // carries the supporting stats (hours, who played it).
  if (gameTotals.size > 0) {
    const sorted = [...gameTotals.entries()].sort((a, b) => b[1] - a[1]);
    for (const [topGameId, topSeconds] of sorted) {
      const game = gameMap.get(topGameId);
      if (!game) continue;
      const players = [...(gamePlayers.get(topGameId) ?? new Set<string>())]
        .filter((uid) => userMap.has(uid))
        .map((uid) => displayName(uid));
      if (players.length === 0) continue;
      const playersFragment =
        players.length === 1
          ? `played by ${players[0]}`
          : players.length === 2
            ? `played by ${players[0]} and 1 other`
            : `played by ${players[0]} and ${players.length - 1} others`;
      slides.push({
        kind: "top_game",
        title: "Most played this week",
        headline: game.mName,
        meta: `${formatHours(topSeconds)} · ${playersFragment}`,
        gameId: topGameId,
        userId: null,
        coverObjectId: gameCover(topGameId),
        avatarObjectId: null,
      });
      break;
    }
  }

  // ── Slide: longest single session ────────────────────────────────────────
  // The PLAYER is the news (a person sat down for hours straight). Headline
  // is the player name; meta names the game and the duration.
  if (longestSession) {
    const game = gameMap.get(longestSession.gameId);
    const user = userMap.get(longestSession.userId);
    if (game && user) {
      slides.push({
        kind: "longest_session",
        title: "Longest session this week",
        headline: displayName(user.id),
        meta: `${formatHours(longestSession.durationSeconds ?? 0)} on ${game.mName}`,
        gameId: game.id,
        userId: user.id,
        // Cover-led: the game art reads better than an avatar for this
        // slide kind (game art is more recognizable at-a-glance than a
        // small avatar would be).
        coverObjectId: gameCover(game.id),
        avatarObjectId: userAvatar(user.id),
      });
    }
  }

  // ── Slide: most achievement unlocks ──────────────────────────────────────
  // The PLAYER is the news. No specific game to anchor to, so the
  // thumbnail slot falls back to the player avatar.
  if (achievementsByUser.size > 0) {
    const sorted = [...achievementsByUser.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [topUserId, count] of sorted) {
      const user = userMap.get(topUserId);
      if (!user) continue;
      slides.push({
        kind: "most_unlocks",
        title: "Achievement hunter",
        headline: displayName(user.id),
        meta: `${count} achievement${count === 1 ? "" : "s"} unlocked this week`,
        gameId: null,
        userId: user.id,
        coverObjectId: null,
        avatarObjectId: userAvatar(user.id),
      });
      break;
    }
  }

  // ── Slide: milestone (cross 25/50/100/250h lifetime in window) ───────────
  // We compute each user's lifetime total before the window and after, and
  // flag the user who crossed the highest threshold this week. Done in JS
  // because the thresholds are non-uniform — DB-side it'd be ugly.
  const MILESTONES = [25, 50, 100, 250]; // hours
  const sessionUserIds = [
    ...new Set(sessions.map((s) => s.userId).filter((id) => userMap.has(id))),
  ];
  if (sessionUserIds.length > 0) {
    // Total seconds per user from the Playtime aggregate (lifetime), fetched above.
    const lifetimeByUser = new Map(
      lifetimeRows.map((r) => [r.userId, r._sum.seconds ?? 0]),
    );

    // Sum of seconds per user from sessions in the window.
    const weekByUser = new Map<string, number>();
    for (const s of sessions) {
      weekByUser.set(
        s.userId,
        (weekByUser.get(s.userId) ?? 0) + (s.durationSeconds ?? 0),
      );
    }

    let bestMilestone: { uid: string; threshold: number } | null = null;
    for (const uid of sessionUserIds) {
      const lifetimeSec = lifetimeByUser.get(uid) ?? 0;
      const weekSec = weekByUser.get(uid) ?? 0;
      const before = (lifetimeSec - weekSec) / 3600;
      const after = lifetimeSec / 3600;
      for (const t of MILESTONES) {
        if (before < t && after >= t) {
          if (!bestMilestone || t > bestMilestone.threshold)
            bestMilestone = { uid, threshold: t };
        }
      }
    }
    if (bestMilestone) {
      const user = userMap.get(bestMilestone.uid);
      if (user) {
        slides.push({
          kind: "milestone",
          title: "New milestone",
          headline: displayName(user.id),
          meta: `Crossed ${bestMilestone.threshold} hours played`,
          gameId: null,
          userId: user.id,
          coverObjectId: null,
          avatarObjectId: userAvatar(user.id),
        });
      }
    }
  }

  // ── Slide: new player (first session inside window) ──────────────────────
  // For each user with a session in the window, check if they have any
  // session that started BEFORE the window — if not, they're new this week.
  if (sessionUserIds.length > 0) {
    const veteranIds = new Set(olderSessions.map((s) => s.userId));
    const newPlayers = sessionUserIds.filter((uid) => !veteranIds.has(uid));
    if (newPlayers.length > 0) {
      // Pick the new player with the most playtime this week (more interesting).
      const ranked = newPlayers
        .map((uid) => {
          let sec = 0;
          for (const s of sessions)
            if (s.userId === uid) sec += s.durationSeconds ?? 0;
          return { uid, sec };
        })
        .sort((a, b) => b.sec - a.sec);
      const top = ranked[0];
      const user = userMap.get(top.uid);
      if (user) {
        slides.push({
          kind: "new_player",
          title: "Welcome to the server",
          headline: displayName(user.id),
          meta: "Joined the action this week",
          gameId: null,
          userId: user.id,
          coverObjectId: null,
          avatarObjectId: userAvatar(user.id),
        });
      }
    }
  }

  // Cap at 5 slides — the carousel should rotate, not become a list.
  return slides.slice(0, 5);
});
