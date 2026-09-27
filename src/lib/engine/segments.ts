// Interval algebra on an unbounded minute axis.
//
// The rest of the engine used to do this arithmetic on a single calendar day,
// clamped to [0, 1440). That clamp was the root cause of a whole family of
// scheduling bugs: an overnight shift had to be cut in half at midnight, and a
// stretch of time with nobody at home was therefore judged as two separate
// short gaps instead of one long one. Everything here works on plain numbers
// with no notion of a day at all, so a span can start on Sunday evening and
// end on Monday morning and still be ONE span.
//
// The unit is "nominal minutes from the start of the window": day index * 1440
// plus minutes past local midnight. Nominal, because a local day is not always
// 1440 real minutes long - see timeline.ts for where real elapsed time (which
// is what the childcare allowance is actually measured in) is computed from
// wall-clock datetimes instead.

export type Span = { start: number; end: number };

export const MINUTES_PER_DAY = 1440;

/** Sorted, non-overlapping, zero-length spans dropped. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** `a` with every part that overlaps `b` removed. */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  const cuts = mergeSpans(b);
  if (cuts.length === 0) return mergeSpans(a);
  const out: Span[] = [];
  for (const seg of mergeSpans(a)) {
    let cursor = seg.start;
    for (const cut of cuts) {
      if (cut.end <= cursor || cut.start >= seg.end) continue;
      if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, seg.end) });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= seg.end) break;
    }
    if (cursor < seg.end) out.push({ start: cursor, end: seg.end });
  }
  return out;
}

/** The parts present in every one of `groups` (pairwise intersection). */
export function intersectSpans(groups: Span[][]): Span[] {
  if (groups.length === 0) return [];
  let acc = mergeSpans(groups[0]);
  for (const group of groups.slice(1)) {
    const other = mergeSpans(group);
    const next: Span[] = [];
    for (const a of acc) {
      for (const b of other) {
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (end > start) next.push({ start, end });
      }
    }
    acc = mergeSpans(next);
  }
  return acc;
}

/** The parts of [windowStart, windowEnd] that `covered` does not cover. */
export function gapsIn(covered: Span[], windowStart: number, windowEnd: number): Span[] {
  return subtractSpans([{ start: windowStart, end: windowEnd }], covered);
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** True if `span` lies entirely inside the union of `within`. */
export function spanIsWithin(span: Span, within: Span[]): boolean {
  return subtractSpans([span], within).length === 0;
}

/** Shifts a within-a-day interval onto the absolute axis for `dayIndex`. */
export function dayIntervalToSpan(
  dayIndex: number,
  interval: { startMinutes: number; endMinutes: number },
): Span {
  const base = dayIndex * MINUTES_PER_DAY;
  return { start: base + interval.startMinutes, end: base + interval.endMinutes };
}

/** The whole of `dayIndex` as a span. */
export function wholeDaySpan(dayIndex: number): Span {
  return { start: dayIndex * MINUTES_PER_DAY, end: (dayIndex + 1) * MINUTES_PER_DAY };
}
