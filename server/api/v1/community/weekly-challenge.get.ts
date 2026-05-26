import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Personal weekly quest — one row per week (`WeeklyChallenge`), per-user
 * progress computed live on every GET.
 *
 * The row is the *prompt* (kind + title + description + target). The
 * `currentValue` / `percentComplete` / `completed` flags in the response are
 * scoped to the caller's own sessions and unlocks; two different users
 * looking at the same week's challenge see the same prompt but different
 * progress.
 *
 * Kind selection rotates from a pool of 9 personal quests. We exclude the
 * last 5 distinct kinds used (read from existing `WeeklyChallenge` rows in
 * the past) so the player doesn't see the same challenge twice in a row,
 * then pick at random from what's left. `genre_focus` additionally rotates
 * its tag — preferring tags whose 30d server-wide playtime is below median,
 * to push underplayed genres.
 *
 * Returns null if no caller (handled via 403 thrown by getUserIdACL) — the
 * shape is meaningless without a user.
 */

// `genre_focus` was dropped from the rotation: tags in our catalogue are
// often metadata-source quirks (e.g. "Flight" appearing as a top-level
// genre) that don't read like a real challenge category to players. The
// kind is still present in the union below as a transitional alias so any
// already-persisted row with kind="genre_focus" survives a deploy without
// breaking type narrowing; selection no longer picks it and progress falls
// back to the play-hours formula for safety.
type PersonalKind =
  | "play_hours"
  | "unlock_count"
  | "play_variety"
  | "rediscover"
  | "marathon"
  | "night_owl"
  | "new_to_you"
  | "genre_focus"
  | "fresh_drop";

const ALL_KINDS: PersonalKind[] = [
  "play_hours",
  "unlock_count",
  "play_variety",
  "rediscover",
  "marathon",
  "night_owl",
  "new_to_you",
  "fresh_drop",
];

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const now = new Date();
  const weekStart = mondayUTCFor(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  // ── Look up or create this week's challenge ────────────────────────────────
  let challenge = await prisma.weeklyChallenge.findUnique({
    where: { weekStart },
    select: {
      id: true,
      kind: true,
      title: true,
      description: true,
      targetValue: true,
      tagId: true,
      weekStart: true,
    },
  });

  if (!challenge) {
    const generated = await generateChallenge(weekStart);
    if (!generated) return null;
    challenge = await prisma.weeklyChallenge.create({
      data: {
        weekStart,
        kind: generated.kind,
        title: generated.title,
        description: generated.description,
        targetValue: generated.targetValue,
        tagId: generated.tagId,
      },
      select: {
        id: true,
        kind: true,
        title: true,
        description: true,
        targetValue: true,
        tagId: true,
        weekStart: true,
      },
    });
  }

  // ── Compute caller's progress against the row ──────────────────────────────
  const currentValue = await computeUserProgress(
    challenge.kind as PersonalKind,
    userId,
    weekStart,
    challenge.tagId,
  );

  const percentComplete =
    challenge.targetValue > 0
      ? Math.min(100, Math.round((currentValue / challenge.targetValue) * 100))
      : 0;
  const completed = currentValue >= challenge.targetValue;

  const msRemaining = Math.max(0, weekEnd.getTime() - now.getTime());
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  return {
    kind: challenge.kind as PersonalKind,
    title: challenge.title,
    description: challenge.description,
    targetValue: challenge.targetValue,
    currentValue,
    percentComplete,
    completed,
    weekStart: challenge.weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    daysRemaining,
  };
});

/**
 * Monday 00:00 UTC for the week containing `date`. ISO weeks start on
 * Monday; using UTC makes the rollover deterministic across server
 * timezones.
 */
function mondayUTCFor(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = Sunday
  const offset = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

interface GeneratedChallenge {
  kind: PersonalKind;
  title: string;
  description: string;
  targetValue: number;
  tagId: string | null;
}

/**
 * Pick a kind, then build the prompt for it. Kind rotation excludes the
 * last 5 distinct kinds used. For week 1 (no history) the full pool is
 * available.
 */
async function generateChallenge(
  weekStart: Date,
): Promise<GeneratedChallenge | null> {
  // Recent kinds, newest first. We pull a generous window and walk it to
  // collect distinct kinds until we have 5 — that way a tag-rotation week
  // that re-picks `genre_focus` doesn't itself consume the slot.
  const recent = await prisma.weeklyChallenge.findMany({
    where: { weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
    take: 20,
    select: { kind: true },
  });
  const excluded = new Set<string>();
  for (const row of recent) {
    excluded.add(row.kind);
    if (excluded.size >= 5) break;
  }

  const pool = ALL_KINDS.filter((k) => !excluded.has(k));
  // If we somehow excluded everything (shouldn't happen — 9 kinds vs 5
  // exclusions) fall back to the full pool to keep the feature alive.
  const candidates = pool.length > 0 ? pool : ALL_KINDS;
  const kind = candidates[Math.floor(Math.random() * candidates.length)];

  return buildPrompt(kind, weekStart);
}

async function buildPrompt(
  kind: PersonalKind,
  weekStart: Date,
): Promise<GeneratedChallenge | null> {
  switch (kind) {
    case "play_hours":
      return {
        kind,
        title: "Marathoner",
        description: "Play 5 hours this week",
        targetValue: 5,
        tagId: null,
      };
    case "unlock_count":
      return {
        kind,
        title: "Trophy Hunter",
        description: "Unlock 8 achievements this week",
        targetValue: 8,
        tagId: null,
      };
    case "play_variety":
      return {
        kind,
        title: "Variety Pack",
        description: "Play 3 different games this week",
        targetValue: 3,
        tagId: null,
      };
    case "rediscover":
      return {
        kind,
        title: "Dusted Off",
        description: "Play a game you haven't touched in 30+ days",
        targetValue: 1,
        tagId: null,
      };
    case "marathon":
      return {
        kind,
        title: "Iron Butt",
        description: "Hold a single 3-hour session",
        targetValue: 1,
        tagId: null,
      };
    case "night_owl":
      return {
        kind,
        title: "Night Owl",
        description: "Play between midnight and 4am",
        targetValue: 1,
        tagId: null,
      };
    case "new_to_you":
      return {
        kind,
        title: "Untried Territory",
        description: "Play a game from your library you've never opened",
        targetValue: 1,
        tagId: null,
      };
    case "fresh_drop":
      return {
        kind,
        title: "Bleeding Edge",
        description: "Play a game added to the server in the last 14 days",
        targetValue: 1,
        tagId: null,
      };
    case "genre_focus": {
      const tag = await pickUnderplayedTag(weekStart);
      if (!tag) return null;
      return {
        kind,
        title: "Genre Pilgrimage",
        description: `Play 3 hours of ${tag.name} this week`,
        targetValue: 3,
        tagId: tag.id,
      };
    }
  }
}

/**
 * For `genre_focus`: pick a random tag from the half of tags whose 30d
 * server-wide playtime is at-or-below median. Falls back to a random tag
 * if no usable pool exists.
 */
async function pickUnderplayedTag(
  weekStart: Date,
): Promise<{ id: string; name: string } | null> {
  const thirtyDaysAgo = new Date(
    weekStart.getTime() - 30 * 24 * 60 * 60 * 1000,
  );

  const tags = await prisma.gameTag.findMany({
    select: {
      id: true,
      name: true,
      games: { select: { id: true } },
    },
  });
  const tagsWithGames = tags.filter((t) => t.games.length > 0);
  if (tagsWithGames.length === 0) {
    // No tags with any games — last resort is any tag at all.
    if (tags.length === 0) return null;
    return tags[Math.floor(Math.random() * tags.length)];
  }

  const totals = await Promise.all(
    tagsWithGames.map(async (tag) => {
      const gameIds = tag.games.map((g) => g.id);
      const agg = await prisma.playSession.aggregate({
        where: {
          gameId: { in: gameIds },
          startedAt: { gte: thirtyDaysAgo },
          durationSeconds: { gt: 0 },
        },
        _sum: { durationSeconds: true },
      });
      return {
        id: tag.id,
        name: tag.name,
        seconds: agg._sum.durationSeconds ?? 0,
      };
    }),
  );

  const sorted = [...totals].sort((a, b) => a.seconds - b.seconds);
  const medianIdx = Math.floor(sorted.length / 2);
  // Below-median half (cheaper-played tags). If sorted.length === 1, this
  // still yields a single-item pool.
  const pool = sorted.slice(0, Math.max(1, medianIdx + 1));
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Compute caller's progress for the active kind. Numbers are in the same
 * units as `targetValue` — whole hours for `play_hours` / `genre_focus`,
 * a raw count for everything else (including binary 0/1 kinds).
 */
async function computeUserProgress(
  kind: PersonalKind,
  userId: string,
  weekStart: Date,
  tagId: string | null,
): Promise<number> {
  switch (kind) {
    case "play_hours": {
      const agg = await prisma.playSession.aggregate({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
        },
        _sum: { durationSeconds: true },
      });
      return Math.round((agg._sum.durationSeconds ?? 0) / 3600);
    }

    case "unlock_count":
      return prisma.userAchievement.count({
        where: { userId, unlockedAt: { gte: weekStart } },
      });

    case "play_variety": {
      const distinct = await prisma.playSession.findMany({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
        },
        select: { gameId: true },
        distinct: ["gameId"],
      });
      return distinct.length;
    }

    case "rediscover": {
      // Games the user touched this week.
      const thisWeekGames = await prisma.playSession.findMany({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
        },
        select: { gameId: true },
        distinct: ["gameId"],
      });
      if (thisWeekGames.length === 0) return 0;

      const thirtyDaysBeforeWeek = new Date(
        weekStart.getTime() - 30 * 24 * 60 * 60 * 1000,
      );

      // For each game played this week, find the user's most recent prior
      // session (strictly before weekStart). If that session is older than
      // 30 days, the quest fires.
      for (const { gameId } of thisWeekGames) {
        const prior = await prisma.playSession.findFirst({
          where: {
            userId,
            gameId,
            startedAt: { lt: weekStart },
            durationSeconds: { gt: 0 },
          },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });
        if (prior && prior.startedAt < thirtyDaysBeforeWeek) return 1;
      }
      return 0;
    }

    case "marathon": {
      const hit = await prisma.playSession.findFirst({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gte: 10800 }, // 3h in seconds
        },
        select: { id: true },
      });
      return hit ? 1 : 0;
    }

    case "night_owl": {
      // Server local time hour ∈ [0,4). Pull this week's sessions for the
      // user and check the hour in the server's local timezone (matches
      // the spec — server local time, not UTC).
      const sessions = await prisma.playSession.findMany({
        where: {
          userId,
          startedAt: { gte: weekStart },
        },
        select: { startedAt: true },
      });
      for (const s of sessions) {
        const hour = s.startedAt.getHours();
        if (hour >= 0 && hour < 4) return 1;
      }
      return 0;
    }

    case "new_to_you": {
      const thisWeekGames = await prisma.playSession.findMany({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
        },
        select: { gameId: true },
        distinct: ["gameId"],
      });
      for (const { gameId } of thisWeekGames) {
        const prior = await prisma.playSession.findFirst({
          where: {
            userId,
            gameId,
            startedAt: { lt: weekStart },
          },
          select: { id: true },
        });
        if (!prior) return 1;
      }
      return 0;
    }

    case "genre_focus": {
      if (!tagId) return 0;
      const tag = await prisma.gameTag.findUnique({
        where: { id: tagId },
        select: { games: { select: { id: true } } },
      });
      if (!tag || tag.games.length === 0) return 0;
      const gameIds = tag.games.map((g) => g.id);
      const agg = await prisma.playSession.aggregate({
        where: {
          userId,
          gameId: { in: gameIds },
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
        },
        _sum: { durationSeconds: true },
      });
      return Math.round((agg._sum.durationSeconds ?? 0) / 3600);
    }

    case "fresh_drop": {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const hit = await prisma.playSession.findFirst({
        where: {
          userId,
          startedAt: { gte: weekStart },
          durationSeconds: { gt: 0 },
          game: { created: { gte: fourteenDaysAgo } },
        },
        select: { id: true },
      });
      return hit ? 1 : 0;
    }
  }
}
