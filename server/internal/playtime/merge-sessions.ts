/**
 * Merge overlapping time intervals and return total non-overlapping seconds.
 * Input must be sorted by startedAt ascending.
 *
 * Example: if session A covers 18:00–22:00 and session B covers 20:00–23:00,
 * the merged interval is 18:00–23:00 = 5 hours (not 4+3 = 7 hours).
 */
export function mergeAndSumSessions(
  sessions: { startedAt: Date; endedAt: Date | null }[],
): number {
  if (sessions.length === 0) return 0;

  let totalSeconds = 0;
  let curStart = sessions[0].startedAt.getTime();
  let curEnd = sessions[0].endedAt?.getTime() ?? curStart;

  for (let i = 1; i < sessions.length; i++) {
    const start = sessions[i].startedAt.getTime();
    const end = sessions[i].endedAt?.getTime() ?? start;

    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      totalSeconds += Math.floor((curEnd - curStart) / 1000);
      curStart = start;
      curEnd = end;
    }
  }

  totalSeconds += Math.floor((curEnd - curStart) / 1000);
  return totalSeconds;
}
