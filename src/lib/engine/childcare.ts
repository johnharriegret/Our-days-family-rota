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

function formatMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Decides whether a single calendar day is safely covered, needs the 3-hour
 * handover allowance, or needs childcare arranging.
 *
 * `coveredIntervals` should already be the union of every adult-presence and
 * school-attendance window for that day (the calendar-aggregation layer builds
 * this from Dad's/Mum's resolved shifts + school hours before calling in).
 *
 * The spec's SAFE/COVERED/HANDOVER/CHILDCARE-NEEDED/SCHEDULE-CONFLICT wording
 * collapses here to three engine-level outcomes: SAFE (no gap at all), HANDOVER
 * (a gap exists but the 3-hour allowance covers it), CHILDCARE_NEEDED (a gap
 * exists that the allowance doesn't cover, whether because it's too long or
 * because the allowance doesn't apply that day). The UI layer (Phase 2) can
 * still choose different wording/severity on top of this.
 */
export function childcareStatus(params: {
  date: string;
  coveredIntervals: DayInterval[];
  oldestChildHome: boolean;
  rule: ChildcareRuleSpec;
}): ChildcareResult {
  const { date, coveredIntervals, oldestChildHome, rule } = params;
  const gaps = uncoveredGaps(coveredIntervals);

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
  const worstGap = gaps.reduce((max, g) =>
    g.endMinutes - g.startMinutes > max.endMinutes - max.startMinutes ? g : max,
  );
  const gapMinutes = worstGap.endMinutes - worstGap.startMinutes;
  const allowanceApplies = (rule.appliesWeekends && isWeekend(date)) || oldestChildHome;
  const gapWindow = `${formatMinutes(worstGap.startMinutes)}–${formatMinutes(worstGap.endMinutes)}`;
  const allowanceHours = Math.round((rule.maxUnsupervisedMinutes / 60) * 10) / 10;

  if (allowanceApplies && gapMinutes <= rule.maxUnsupervisedMinutes) {
    return {
      status: "HANDOVER",
      uncoveredMinutes: totalUncovered,
      gapStart: formatMinutes(worstGap.startMinutes),
      gapEnd: formatMinutes(worstGap.endMinutes),
      explanation: `Children are without an adult from ${gapWindow}, within your ${allowanceHours}-hour allowance.`,
    };
  }

  const reason = allowanceApplies
    ? `exceeds your ${allowanceHours}-hour allowance`
    : "your current rule doesn't allow unsupervised time today";
  return {
    status: "CHILDCARE_NEEDED",
    uncoveredMinutes: totalUncovered,
    gapStart: formatMinutes(worstGap.startMinutes),
    gapEnd: formatMinutes(worstGap.endMinutes),
    explanation: `Both parents would be working from ${gapWindow}. This creates ${Math.round((gapMinutes / 60) * 10) / 10} hours without an adult at home, which ${reason}.`,
  };
}
