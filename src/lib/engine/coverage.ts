import { uncoveredGaps } from "./childcare";
import type { DayInterval } from "./types";

type ShiftTimes = { startLocal: string; endLocal: string } | null;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The minutes-of-day (within [0, 1440)) that a worker is AWAY at work on a given
 * calendar day, given that day's shift and the previous day's shift.
 *
 * A shift whose end is at or before its start is treated as overnight: it runs
 * to midnight on its own day and resumes at 00:00 on the next day. So a night
 * shift starting the evening before contributes an early-morning away block to
 * this day.
 */
export function awayIntervalsForDay(today: ShiftTimes, yesterday: ShiftTimes): DayInterval[] {
  const out: DayInterval[] = [];
  if (today) {
    const s = toMinutes(today.startLocal);
    const e = toMinutes(today.endLocal);
    out.push(e <= s ? { startMinutes: s, endMinutes: 1440 } : { startMinutes: s, endMinutes: e });
  }
  if (yesterday) {
    const s = toMinutes(yesterday.startLocal);
    const e = toMinutes(yesterday.endLocal);
    if (e <= s) out.push({ startMinutes: 0, endMinutes: e });
  }
  return out;
}

/** The minutes-of-day a worker is at HOME (complement of their away time). */
export function homeIntervalsForDay(today: ShiftTimes, yesterday: ShiftTimes): DayInterval[] {
  return uncoveredGaps(awayIntervalsForDay(today, yesterday));
}
