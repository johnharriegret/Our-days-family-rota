import { isWeekend } from "./dates";
import type { ChildcareResult, ChildcareRuleSpec, DayInterval } from "./types";

function mergeIntervals(intervals: DayInterval[]): DayInterval[] {
  const sorted = [...intervals]
    .filter((iv) => iv.endMinutes > iv.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: DayInterval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, iv.endMinutes);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** The gaps in [0, 1440) not covered by any of `covered`. */
export function uncoveredGaps(covered: DayInterval[]): DayInterval[] {
  const merged = mergeIntervals(covered);
  const gaps: DayInterval[] = [];
  let cursor = 0;
  for (const iv of merged) {
    if (iv.startMinutes > cursor) {
      gaps.push({ startMinutes: cursor, endMinutes: iv.startMinutes });
    }
    cursor = Math.max(cursor, iv.endMinutes);
  }
  if (cursor < 1440) gaps.push({ startMinutes: cursor, endMinutes: 1440 });
  return gaps;
}

/** `a` with every portion overlapping any interval in `b` removed. */
export function subtractIntervals(a: DayInterval[], b: DayInterval[]): DayInterval[] {
  const bMerged = mergeIntervals(b);
  if (bMerged.length === 0) return mergeIntervals(a);
  const result: DayInterval[] = [];
  for (const seg of mergeIntervals(a)) {
    let cursor = seg.startMinutes;
    for (const cut of bMerged) {
      if (cut.endMinutes <= cursor || cut.startMinutes >= seg.endMinutes) continue;
      if (cut.startMinutes > cursor) {
        result.push({ startMinutes: cursor, endMinutes: Math.min(cut.startMinutes, seg.endMinutes) });
      }
      cursor = Math.max(cursor, cut.endMinutes);
      if (cursor >= seg.endMinutes) break;
    }
    if (cursor < seg.endMinutes) result.push({ startMinutes: cursor, endMinutes: seg.endMinutes });
  }
  return result;
}

/**
 * The drop-off/pick-up duty windows for a child below the household's
 * "strict pickup age": a short buffer immediately before school starts and
 * immediately after it ends, during which only an actual adult counts as
 * cover - a supervisor-age sibling cannot substitute (they can't do a school
 * run). Empty when the child doesn't attend school that day: with no school
 * run to make, the ordinary supervisor-sibling allowance applies as normal
 * all day, per the household's own choice to scope this narrowly.
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

function formatMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** True if [g.start,g.end] lies entirely within the union of `intervals`. */
function isWithin(g: DayInterval, intervals: DayInterval[]): boolean {
  for (const iv of mergeIntervals(intervals)) {
    if (g.startMinutes >= iv.startMinutes && g.endMinutes <= iv.endMinutes) return true;
  }
  return false;
}

/**
 * Decides whether a single calendar day is safely covered, needs the 3-hour
 * handover allowance, or needs childcare arranging.
 *
 * `coveredIntervals` should already be the union of every adult-presence and
 * school-attendance window for that day (the calendar-aggregation layer builds
 * this from Dad's/Mum's resolved shifts + school hours before calling in).
 *
 * `supervisorHome` is the union of minutes a supervisor-age child (e.g. the
 * 13-year-old) is at home and could supervise - typically the after-school
 * hours on a school day, or the whole day when they're off school. A gap that
 * falls entirely within that window (or on a weekend, if the rule allows) and
 * is no longer than the allowance counts as a HANDOVER rather than a conflict.
 * This is what lets a parent work a shift that ends a little after school pickup
 * without it being flagged as "childcare needed".
 *
 * Outcomes: SAFE (no gap), HANDOVER (every gap is allowed), CHILDCARE_NEEDED
 * (some gap is too long, or happens when nobody - adult or supervisor - is
 * available).
 */
export function childcareStatus(params: {
  date: string;
  coveredIntervals: DayInterval[];
  supervisorHome: DayInterval[];
  rule: ChildcareRuleSpec;
  /**
   * True when every school-age child is off for a recognised school
   * holiday, INSET day, or bank holiday (NOT merely a weekend, which
   * `isWeekend(date)` below already covers on its own). On an ordinary
   * school day this must be false/omitted, which is what makes a
   * before-school handover gap a hard CHILDCARE_NEEDED regardless of the
   * usual allowance: there's no school run to skip, so the gap is only
   * ever excused by a supervisor-age sibling being home, same as any
   * other weekday. Passing this true relaxes that the same way a weekend
   * does, since there's no morning school prep to supervise either.
   */
  isSchoolHoliday?: boolean;
}): ChildcareResult {
  const { date, coveredIntervals, supervisorHome, rule, isSchoolHoliday } = params;
  const gaps = uncoveredGaps(coveredIntervals);
  const allowanceHours = Math.round((rule.maxUnsupervisedMinutes / 60) * 10) / 10;

  if (gaps.length === 0) {
    return {
      status: "SAFE",
      uncoveredMinutes: 0,
      gapStart: null,
      gapEnd: null,
      explanation: "An adult or school covers the whole day.",
    };
  }

  const totalUncovered = gaps.reduce((sum, g) => sum + (g.endMinutes - g.startMinutes), 0);
  const weekendAllows = rule.appliesWeekends && (isWeekend(date) || isSchoolHoliday === true);

  // A gap is allowed if it's short enough AND either the weekend allowance
  // applies or a supervisor-age child is home for the whole of it.
  function gapAllowed(g: DayInterval): boolean {
    const minutes = g.endMinutes - g.startMinutes;
    if (minutes > rule.maxUnsupervisedMinutes) return false;
    return weekendAllows || isWithin(g, supervisorHome);
  }

  const disallowed = gaps.filter((g) => !gapAllowed(g));

  if (disallowed.length === 0) {
    const worst = gaps.reduce((a, b) => (b.endMinutes - b.startMinutes > a.endMinutes - a.startMinutes ? b : a));
    const win = `${formatMinutes(worst.startMinutes)}–${formatMinutes(worst.endMinutes)}`;
    return {
      status: "HANDOVER",
      uncoveredMinutes: totalUncovered,
      gapStart: formatMinutes(worst.startMinutes),
      gapEnd: formatMinutes(worst.endMinutes),
      explanation: `Children are without an adult from ${win}, within your ${allowanceHours}-hour allowance.`,
    };
  }

  const worst = disallowed.reduce((a, b) => (b.endMinutes - b.startMinutes > a.endMinutes - a.startMinutes ? b : a));
  const gapMinutes = worst.endMinutes - worst.startMinutes;
  const win = `${formatMinutes(worst.startMinutes)}–${formatMinutes(worst.endMinutes)}`;
  const reason =
    gapMinutes > rule.maxUnsupervisedMinutes
      ? `exceeds your ${allowanceHours}-hour allowance`
      : "your current rule doesn't allow unsupervised time then";
  return {
    status: "CHILDCARE_NEEDED",
    uncoveredMinutes: totalUncovered,
    gapStart: formatMinutes(worst.startMinutes),
    gapEnd: formatMinutes(worst.endMinutes),
    explanation: `No adult is at home from ${win}. That is ${Math.round((gapMinutes / 60) * 10) / 10} hours without cover, which ${reason}.`,
  };
}
