import { type Span, mergeSpans, subtractSpans } from "./segments";
import type { DayInterval } from "./types";

// Day-level interval helpers, kept for the places that genuinely only ever
// describe one day at a time (a school's hours, a sibling's time at home).
// They are thin adapters over the unbounded algebra in segments.ts so there is
// exactly one implementation of the arithmetic.
//
// NOTE: the rule engine that used to live here - `childcareStatus`, which
// judged a single calendar day in isolation - is gone. It could not see a
// stretch of unattended time that crossed midnight (it read 21:00-03:00 as two
// separate short gaps and allowed both), and being called from two different
// places let the calendar and the shift planner enforce subtly different
// rules. All childcare validation now happens in one place, over a continuous
// timeline: see `evaluateTimeline` in timeline.ts.

function toSpans(intervals: DayInterval[]): Span[] {
  return intervals.map((iv) => ({ start: iv.startMinutes, end: iv.endMinutes }));
}

function toIntervals(spans: Span[]): DayInterval[] {
  return spans.map((s) => ({ startMinutes: s.start, endMinutes: s.end }));
}

/** The gaps in [0, 1440) not covered by any of `covered`. */
export function uncoveredGaps(covered: DayInterval[]): DayInterval[] {
  return toIntervals(subtractSpans([{ start: 0, end: 1440 }], toSpans(covered)));
}

/** `a` with every portion overlapping any interval in `b` removed. */
export function subtractIntervals(a: DayInterval[], b: DayInterval[]): DayInterval[] {
  return toIntervals(subtractSpans(toSpans(a), toSpans(b)));
}

/** Sorted, merged, zero-length intervals dropped. */
export function mergeDayIntervals(intervals: DayInterval[]): DayInterval[] {
  return toIntervals(mergeSpans(toSpans(intervals)));
}

/**
 * The drop-off/pick-up duty windows for a child below the household's
 * "strict pickup age": a short buffer immediately before school starts and
 * immediately after it ends, during which only an actual adult counts as
 * cover - a supervisor-age sibling cannot substitute (they can't do a school
 * run). Empty when the child doesn't attend school that day: with no school
 * run to make, the ordinary supervisor-sibling allowance applies as normal
 * all day, per the household's own choice to scope this narrowly.
 *
 * This is the narrower, per-child rule the household configured for its
 * youngest. The broader rule - that every school day's morning routine and
 * pick-up needs an adult, for any child who actually attends - is
 * `schoolRunAdultWindows` in timeline.ts. Both are applied; the broader one
 * subsumes this in most configurations, and this one still carves the sibling
 * allowance for a child whose school hours differ from a sibling's.
 */
export function pickupDutyWindows(params: {
  attendsSchoolToday: boolean;
  schoolStartMinutes: number;
  schoolEndMinutes: number;
  bufferMinutes: number;
}): DayInterval[] {
  if (!params.attendsSchoolToday) return [];
  const { schoolStartMinutes, schoolEndMinutes, bufferMinutes } = params;
  return [
    { startMinutes: Math.max(0, schoolStartMinutes - bufferMinutes), endMinutes: schoolStartMinutes },
    { startMinutes: schoolEndMinutes, endMinutes: Math.min(1440, schoolEndMinutes + bufferMinutes) },
  ].filter((iv) => iv.endMinutes > iv.startMinutes);
}
