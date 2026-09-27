import { addDays, isWeekend } from "./dates";
import { localDateTimeToUtc } from "./intervals";
import {
  MINUTES_PER_DAY,
  type Span,
  dayIntervalToSpan,
  gapsIn,
  intersectSpans,
  mergeSpans,
  spanIsWithin,
  spansOverlap,
  subtractSpans,
  wholeDaySpan,
} from "./segments";
import type { ChildcareResult, ChildcareStatus, DayInterval } from "./types";

/**
 * The one childcare validator.
 *
 * Everything that needs to know "are the children covered?" goes through
 * `evaluateTimeline` - the live calendar, the shift optimiser's candidate
 * scoring, and the check made when a plan is applied. There is deliberately
 * only one implementation of the household's rules, because the previous
 * arrangement (a day-level judge called separately from two places, each
 * building its own inputs) let the calendar and the planner disagree, and let
 * a rule be enforced in a unit test while never firing in production.
 *
 * The model is a continuous timeline, not a series of days:
 *
 *   - A shift is ONE span. A night shift that starts at 20:00 and ends at
 *     08:00 is a single 12-hour span crossing midnight, not two half-shifts.
 *   - A stretch with no adult at home is ONE gap, however many dates it
 *     touches. 21:00 to 03:00 is a six-hour gap, not two three-hour ones.
 *   - A gap's length is measured in REAL elapsed minutes, converted through
 *     the timezone, so the night the clocks change is an hour longer or
 *     shorter exactly as it is in life.
 *   - Weekly, monthly and yearly groupings are display concepts. They never
 *     appear here.
 *
 * The caller passes a window that includes context days either side of the
 * range being reported on (see `reportFrom`/`reportTo`), so a shift starting
 * the evening before the range, or running into the morning after it, is still
 * part of the picture.
 */

export type TimelineShift = { startLocal: string; endLocal: string };

/** One adult's whereabouts for one day of the window. */
export type AdultDay = {
  /** false when this person has no rota and nothing entered - unknowable, not "off". */
  known: boolean;
  /** null = at home all day. */
  shift: TimelineShift | null;
};

export type TimelineDay = {
  date: string;
  /** false when there is nobody to cover (no children in the household). */
  hasChildren: boolean;
  /** the window during which EVERY child is at school/nursery; null if any child is home. */
  schoolCover: DayInterval | null;
  /** minutes a supervisor-age sibling is home and could supervise. */
  supervisorHome: DayInterval[];
  /**
   * Windows where only an actual adult will do, and a supervisor-age sibling
   * or the unattended allowance cannot substitute: the school-run and
   * morning-prep periods on a day a child actually attends school. Built by
   * `schoolRunAdultWindows` so every caller produces them identically.
   */
  adultOnlyWindows: DayInterval[];
  /**
   * True when every school-linked child is off for a recognised school
   * holiday, INSET day or bank holiday - NOT merely a weekend, which is
   * derived from the date itself. There is no school run to make, so the
   * ordinary unattended allowance applies just as it does at a weekend.
   */
  isSchoolHoliday: boolean;
};

export type TimelineInput = {
  timeZone: string;
  /** the whole window, context days included, in date order. */
  days: TimelineDay[];
  /** [adultIndex][dayIndex], aligned with `days`. */
  adults: AdultDay[][];
  rule: { maxUnsupervisedMinutes: number; appliesWeekends: boolean };
  /** first index of `days` actually being reported on (context days precede it). */
  reportFrom: number;
  /** last index of `days` actually being reported on (inclusive). */
  reportTo: number;
};

export type GapRejection = "SCHOOL_RUN" | "TOO_LONG" | "NO_SUPERVISION";

/**
 * A stretch of the window with no adult at home, with enough detail attached
 * to explain in plain English exactly why it was or wasn't acceptable. This is
 * the traceable "why was this rejected" record: nothing in the app decides a
 * plan is unsafe without one of these to point at.
 */
export type TimelineGap = {
  startDate: string;
  startLocal: string;
  endDate: string;
  endLocal: string;
  /** real elapsed minutes, through the timezone - not a nominal clock difference. */
  elapsedMinutes: number;
  /** true when this crosses midnight, i.e. it would have been missed day-by-day. */
  crossesMidnight: boolean;
  allowed: boolean;
  /** why it was rejected; empty when allowed. */
  rejections: GapRejection[];
  explanation: string;
  /** every date the gap touches - the days it should be reported against. */
  dates: string[];
  debug: {
    /** per adult, what they were doing when the gap began. */
    adultStates: ("WORKING" | "HOME" | "UNKNOWN")[];
    /** whether school covered any part of the gap's first day. */
    schoolCoveredPartOfDay: boolean;
    /** the unattended allowance was available on every day the gap touches. */
    allowanceApplies: boolean;
    /** a supervisor-age sibling was home for the whole gap. */
    supervisorCoveredWholeGap: boolean;
    /** the gap ran into a school-run/morning-prep window needing an adult. */
    overlapsSchoolRun: boolean;
    maxUnsupervisedMinutes: number;
  };
};

export type TimelineResult = {
  /** every uncovered stretch that touches the reported range. */
  gaps: TimelineGap[];
  /** the subset that the household's rules do not allow. */
  conflicts: TimelineGap[];
  /** per reported date: the day-level verdict, or null when it can't be judged. */
  byDate: Record<string, ChildcareResult | null>;
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hoursLabel(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * One adult's away-from-home time across the whole window, as continuous
 * spans. A shift whose end is at or before its start runs into the next day
 * (the same convention as intervals.ts) and stays a single span - which is the
 * entire point of this function existing.
 */
export function awaySpansFor(adultDays: AdultDay[]): Span[] {
  const spans: Span[] = [];
  adultDays.forEach((day, i) => {
    if (!day.shift) return;
    const start = toMinutes(day.shift.startLocal);
    const end = toMinutes(day.shift.endLocal);
    const base = i * MINUTES_PER_DAY;
    spans.push({
      start: base + start,
      end: end <= start ? base + MINUTES_PER_DAY + end : base + end,
    });
  });
  return mergeSpans(spans);
}

/**
 * The drop-off/pick-up and morning-prep windows on one day during which an
 * actual adult must be available, for every child who genuinely attends school
 * or nursery that day.
 *
 * A school day is not "covered by school all day": somebody has to wake the
 * children, get them ready and physically take them, and be there to collect
 * them. Neither an older sibling nor the unattended allowance can stand in for
 * that, which is why these windows are kept separate from ordinary supervision.
 * On a day a child doesn't attend there is no school run, so the window is
 * empty and the ordinary rules apply.
 */
export function schoolRunAdultWindows(params: {
  children: {
    hasSchool: boolean;
    attendsToday: boolean;
    schoolStartMinutes: number;
    schoolEndMinutes: number;
  }[];
  /** minutes past midnight from which the morning routine needs an adult. */
  morningFromMinutes: number;
  /** how long after school ends an adult must still be available. */
  pickupBufferMinutes: number;
}): DayInterval[] {
  const out: DayInterval[] = [];
  for (const child of params.children) {
    if (!child.hasSchool || !child.attendsToday) continue;
    const morningStart = Math.max(0, Math.min(params.morningFromMinutes, child.schoolStartMinutes));
    if (child.schoolStartMinutes > morningStart) {
      out.push({ startMinutes: morningStart, endMinutes: child.schoolStartMinutes });
    }
    const afternoonEnd = Math.min(MINUTES_PER_DAY, child.schoolEndMinutes + params.pickupBufferMinutes);
    if (afternoonEnd > child.schoolEndMinutes) {
      out.push({ startMinutes: child.schoolEndMinutes, endMinutes: afternoonEnd });
    }
  }
  return out;
}

export function evaluateTimeline(input: TimelineInput): TimelineResult {
  const { days, adults, rule, timeZone } = input;
  const dayCount = days.length;
  const windowStart = 0;
  const windowEnd = dayCount * MINUTES_PER_DAY;

  /** The date and time-of-day a nominal absolute minute refers to. */
  function positionOf(minute: number): { date: string; timeLocal: string } {
    const dayIndex = Math.floor(minute / MINUTES_PER_DAY);
    const within = minute - dayIndex * MINUTES_PER_DAY;
    if (dayIndex < dayCount) {
      return { date: days[dayIndex].date, timeLocal: formatMinutes(within) };
    }
    // The very end of the window: midnight after the last day.
    return { date: addDays(days[dayCount - 1].date, dayIndex - (dayCount - 1)), timeLocal: formatMinutes(within) };
  }

  /** Real elapsed minutes between two nominal positions, through the timezone. */
  function elapsedMinutes(from: number, to: number): number {
    const a = positionOf(from);
    const b = positionOf(to);
    const startUtc = localDateTimeToUtc(a.date, a.timeLocal, timeZone);
    const endUtc = localDateTimeToUtc(b.date, b.timeLocal, timeZone);
    return Math.round((endUtc.getTime() - startUtc.getTime()) / 60_000);
  }

  // An adult covers the household whenever they are not away at work, so the
  // children are uncovered only while EVERY adult is away at once.
  const awayByAdult = adults.map((adultDays) => awaySpansFor(adultDays));
  const allAdultsAway = awayByAdult.length > 0 ? intersectSpans(awayByAdult) : [];
  const adultCover = subtractSpans([{ start: windowStart, end: windowEnd }], allAdultsAway);

  const schoolCover: Span[] = [];
  const adultOnly: Span[] = [];
  const permissive: Span[] = []; // where a gap may be excused at all
  days.forEach((day, i) => {
    if (day.schoolCover) schoolCover.push(dayIntervalToSpan(i, day.schoolCover));
    for (const w of day.adultOnlyWindows) adultOnly.push(dayIntervalToSpan(i, w));
    const allowanceToday = rule.appliesWeekends && (isWeekend(day.date) || day.isSchoolHoliday);
    if (allowanceToday) {
      permissive.push(wholeDaySpan(i));
    } else {
      for (const w of day.supervisorHome) permissive.push(dayIntervalToSpan(i, w));
    }
  });

  // A day nobody can be judged on (a parent isn't set up, or there are no
  // children) is excluded from the verdict, but a shift on it still counts
  // towards coverage - not knowing about Monday must never invent cover.
  const judgeable = days.map((day, i) => day.hasChildren && adults.every((a) => a[i].known));

  const covered = mergeSpans([...adultCover, ...schoolCover]);
  const rawGaps = gapsIn(covered, windowStart, windowEnd);

  const permissiveMerged = mergeSpans(permissive);
  const adultOnlyMerged = mergeSpans(adultOnly);

  const reportStart = input.reportFrom * MINUTES_PER_DAY;
  const reportEnd = (input.reportTo + 1) * MINUTES_PER_DAY;

  /**
   * Whether a gap is this range's business.
   *
   * A gap inside the range obviously is. A gap that falls entirely on a
   * trailing context day is too, but only when it was CAUSED from inside the
   * range - a night shift starting on the last planned day and running into the
   * next morning. That is the Sunday-night-into-Monday-morning case, and
   * reporting it is the whole reason the trailing context day exists.
   *
   * The test is whether any adult's spell away from home that overlaps the gap
   * began inside the range. If none did, the gap belongs to the neighbouring
   * range and is left to it - otherwise every week would inherit its
   * neighbour's problems and no week could ever be planned.
   */
  function isThisRangesBusiness(gap: Span): boolean {
    if (spansOverlap(gap, { start: reportStart, end: reportEnd })) return true;
    return awayByAdult.some((spans) =>
      spans.some((away) => spansOverlap(away, gap) && away.start >= reportStart && away.start < reportEnd),
    );
  }

  const gaps: TimelineGap[] = [];
  for (const gap of rawGaps) {
    if (!isThisRangesBusiness(gap)) continue;

    const firstDay = Math.floor(gap.start / MINUTES_PER_DAY);
    const lastDay = Math.floor((gap.end - 1) / MINUTES_PER_DAY);
    const touchedDates: string[] = [];
    for (let i = firstDay; i <= lastDay && i < dayCount; i++) {
      if (judgeable[i]) touchedDates.push(days[i].date);
    }
    // A gap that only touches days nobody can be judged on isn't a finding.
    if (touchedDates.length === 0) continue;

    const elapsed = elapsedMinutes(gap.start, gap.end);
    const overlapsSchoolRun = adultOnlyMerged.some((w) => spansOverlap(gap, w));
    const withinPermissive = spanIsWithin(gap, permissiveMerged);
    const tooLong = elapsed > rule.maxUnsupervisedMinutes;

    const rejections: GapRejection[] = [];
    if (overlapsSchoolRun) rejections.push("SCHOOL_RUN");
    if (tooLong) rejections.push("TOO_LONG");
    if (!withinPermissive) rejections.push("NO_SUPERVISION");

    const from = positionOf(gap.start);
    const to = positionOf(gap.end);
    const crossesMidnight = firstDay !== lastDay;

    const allowanceApplies = days.every((day, i) => {
      if (i < firstDay || i > lastDay) return true;
      return rule.appliesWeekends && (isWeekend(day.date) || day.isSchoolHoliday);
    });
    const supervisorCoveredWholeGap =
      !allowanceApplies &&
      spanIsWithin(
        gap,
        mergeSpans(
          days.flatMap((day, i) =>
            i >= firstDay && i <= lastDay ? day.supervisorHome.map((w) => dayIntervalToSpan(i, w)) : [],
          ),
        ),
      );

    gaps.push({
      startDate: from.date,
      startLocal: from.timeLocal,
      endDate: to.date,
      endLocal: to.timeLocal,
      elapsedMinutes: elapsed,
      crossesMidnight,
      allowed: rejections.length === 0,
      rejections,
      explanation: explainGap({
        from,
        to,
        elapsed,
        crossesMidnight,
        rejections,
        maxUnsupervisedMinutes: rule.maxUnsupervisedMinutes,
      }),
      dates: touchedDates,
      debug: {
        adultStates: adults.map((adultDays) => {
          const state = adultDays[Math.min(firstDay, dayCount - 1)];
          if (!state.known) return "UNKNOWN" as const;
          return state.shift ? ("WORKING" as const) : ("HOME" as const);
        }),
        schoolCoveredPartOfDay: firstDay < dayCount ? days[firstDay].schoolCover != null : false,
        allowanceApplies,
        supervisorCoveredWholeGap,
        overlapsSchoolRun,
        maxUnsupervisedMinutes: rule.maxUnsupervisedMinutes,
      },
    });
  }

  const byDate: Record<string, ChildcareResult | null> = {};
  for (let i = input.reportFrom; i <= input.reportTo; i++) {
    const day = days[i];
    if (!judgeable[i]) {
      byDate[day.date] = null;
      continue;
    }
    const touching = gaps.filter((g) => g.dates.includes(day.date));
    byDate[day.date] = dayVerdict(touching);
  }

  return { gaps, conflicts: gaps.filter((g) => !g.allowed), byDate };
}

function explainGap(params: {
  from: { date: string; timeLocal: string };
  to: { date: string; timeLocal: string };
  elapsed: number;
  crossesMidnight: boolean;
  rejections: GapRejection[];
  maxUnsupervisedMinutes: number;
}): string {
  const { from, to, elapsed, crossesMidnight, rejections, maxUnsupervisedMinutes } = params;
  const window = crossesMidnight
    ? `${from.timeLocal} on ${dayName(from.date)} until ${to.timeLocal} on ${dayName(to.date)}`
    : `${from.timeLocal}–${to.timeLocal}`;
  const allowanceHours = hoursLabel(maxUnsupervisedMinutes);

  if (rejections.length === 0) {
    return `Children are without an adult from ${window}, within your ${allowanceHours}-hour allowance.`;
  }
  if (rejections.includes("SCHOOL_RUN")) {
    return `No adult is at home from ${window}, which is when the children need to be got ready for school or collected from it. That needs an adult, whoever else is home.`;
  }
  const reason = rejections.includes("TOO_LONG")
    ? `exceeds your ${allowanceHours}-hour allowance`
    : "your current rule doesn't allow unsupervised time then";
  return `No adult is at home from ${window}. That is ${hoursLabel(elapsed)} hours without cover, which ${reason}.`;
}

function dayName(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Rolls the gaps touching one date into that date's single displayed verdict. */
function dayVerdict(touching: TimelineGap[]): ChildcareResult {
  if (touching.length === 0) {
    return {
      status: "SAFE",
      uncoveredMinutes: 0,
      gapStart: null,
      gapEnd: null,
      explanation: "An adult or school covers the whole day.",
    };
  }
  const bad = touching.filter((g) => !g.allowed);
  const pool = bad.length > 0 ? bad : touching;
  const worst = pool.reduce((a, b) => (b.elapsedMinutes > a.elapsedMinutes ? b : a));
  const status: ChildcareStatus = bad.length > 0 ? "CHILDCARE_NEEDED" : "HANDOVER";
  return {
    status,
    uncoveredMinutes: touching.reduce((sum, g) => sum + g.elapsedMinutes, 0),
    gapStart: worst.startLocal,
    gapEnd: worst.endLocal,
    explanation: worst.explanation,
  };
}

export { hoursLabel as timelineHoursLabel, MINUTES_PER_DAY as TIMELINE_MINUTES_PER_DAY };
