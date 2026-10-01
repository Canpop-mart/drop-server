import prisma from "~/server/internal/db/database";
import { mergeAndSumSessions } from "./merge-sessions";

/**
 * Upper bound on a single play session's client-reported duration: 48 hours.
 * Client bugs (clock skew, overflow, negative-to-unsigned cast) or tampering
 * would push values beyond this, so it is clamped rather than trusted.
 */
export const MAX_SESSION_DURATION_SECS = 48 * 60 * 60;

/**
 * Clamp a reported session length: never negative, never over 48 hours, and
 * never longer than the wall-clock time since the session started (plus 30s
 * for network jitter). The elapsed bound is what stops a client claiming 47
 * hours for a session that started two minutes ago.
 *
 * Pure and untested: drop-server has no test runner.
 */
export function clampSessionDuration(
  reportedSecs: number,
  startedAt: Date,
  now: Date,
): number {
  const elapsedSinceStart =
    Math.floor((now.getTime() - startedAt.getTime()) / 1000) + 30;
  return Math.max(
    0,
    Math.min(
      Math.floor(reportedSecs),
      MAX_SESSION_DURATION_SECS,
      Math.max(elapsedSinceStart, 0),
    ),
  );
}

/**
 * How long after a session started a client may still report its measured
 * length for it. Queued stops replay at the client's next start, which is
 * normally within days; anything later is more likely a bug or tampering
 * than a real measurement, and is refused.
 */
export const MAX_LATE_REPORT_MS = 7 * 24 * 60 * 60 * 1000;

/** A span of time in epoch milliseconds, `start` <= `end`. */
export interface Span {
  start: number;
  end: number;
}

/**
 * The parts of `[start, end)` that none of `busy` covers, in order. Empty
 * and zero-length busy spans cover nothing.
 *
 * Pure and untested: drop-server has no test runner.
 */
export function freeSpans(start: number, end: number, busy: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = start;
  const sorted = busy
    .filter((b) => b.end > b.start && b.end > start && b.start < end)
    .sort((a, b) => a.start - b.start);
  for (const b of sorted) {
    if (b.start > cursor)
      out.push({ start: cursor, end: Math.min(b.start, end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out.filter((s) => s.end > s.start);
}

/**
 * Keep at most `maxSeconds` of `spans`, cutting from the end.
 *
 * Pure and untested: drop-server has no test runner.
 */
export function capSpans(spans: Span[], maxSeconds: number): Span[] {
  const out: Span[] = [];
  let left = Math.max(Math.floor(maxSeconds), 0) * 1000;
  for (const s of spans) {
    if (left <= 0) break;
    const len = Math.min(s.end - s.start, left);
    out.push({ start: s.start, end: s.start + len });
    left -= len;
  }
  return out;
}

/** Most play time one user can be credited with in any 24 hours. */
export const MAX_SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Seconds already credited to `userId` in sessions that started within the
 * 24 hours before `end`, excluding `excludeId`. With a 24-hour cap per day,
 * a client cannot invent more play than there was time for.
 */
export async function secondsCreditedInDayBefore(
  userId: string,
  end: Date,
  excludeId?: string,
): Promise<number> {
  const agg = await prisma.playSession.aggregate({
    where: {
      userId,
      startedAt: {
        gte: new Date(end.getTime() - MAX_SECONDS_PER_DAY * 1000),
        lt: end,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    _sum: { durationSeconds: true },
  });
  return agg._sum.durationSeconds ?? 0;
}

/**
 * Recompute one user's cumulative playtime for one game from their finished
 * sessions, merging overlaps so concurrent sessions cannot double count.
 */
export async function recomputeUserGamePlaytime(
  gameId: string,
  userId: string,
): Promise<number> {
  const sessions = await prisma.playSession.findMany({
    where: { gameId, userId, endedAt: { not: null } },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, endedAt: true },
  });
  const totalSeconds = mergeAndSumSessions(sessions);
  await prisma.playtime.upsert({
    where: { gameId_userId: { gameId, userId } },
    create: { gameId, userId, seconds: totalSeconds },
    update: { seconds: totalSeconds },
  });
  return totalSeconds;
}
