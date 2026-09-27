import { pickupDutyWindows, subtractIntervals } from "./childcare";
import { schoolRunAdultWindows, type TimelineDay } from "./timeline";
import type { DayInterval } from "./types";

/**
 * Turns one day's raw household facts into the shape the timeline validator
 * consumes.
 *
 * This exists so the live calendar and the shift planner cannot drift apart.
 * They used to build these inputs separately - sixty near-identical lines in
 * each - and a rule tightened in one place silently stayed loose in the other.
 * Both now call this, so "what counts as covered" has a single definition.
 *
 * Pure: it takes plain numbers and booleans, never a database row.
 */

export type ChildDayInfo = {
  /** false for a child with no school/nursery linked at all. */
  hasSchool: boolean;
  /** true only if they genuinely attend on this date (term, right weekday, not INSET/bank holiday). */
  attendsToday: boolean;
  schoolStartMinutes: number;
  schoolEndMinutes: number;
  /** whole years on this date, or null when the date of birth isn't known. */
  age: number | null;
  /** why they're not at school today, when they aren't and we can tell. */
  nonSchoolReasonKind:
    | "BANK_HOLIDAY"
    | "HOLIDAY"
    | "INSET"
    | "WEEKEND"
    | "NOT_A_TERM_DAY"
    | "UNKNOWN"
    | null;
};

export type HouseholdRuleConfig = {
  maxUnsupervisedMinutes: number;
  appliesWeekends: boolean;
  /** from this age a sibling can supervise; null = never. */
  minSupervisorAge: number | null;
  /** below this age a sibling can't do this child's own school run; null = off. */
  strictPickupAge: number | null;
  pickupBufferMinutes: number;
  /** minutes past midnight from which a school morning needs an adult. */
  schoolRunMorningFromMinutes: number;
};

export const DEFAULT_SCHOOL_RUN_MORNING_FROM = "06:00";
export const DEFAULT_PICKUP_BUFFER_MINUTES = 30;
export const DEFAULT_MAX_UNSUPERVISED_MINUTES = 180;

export function buildTimelineDay(
  date: string,
  children: ChildDayInfo[],
  rule: HouseholdRuleConfig,
): TimelineDay {
  // School only covers the children while EVERY child is there - a child at
  // home still needs an adult - so this is the intersection of their hours,
  // not the union.
  let schoolCover: DayInterval | null = null;
  if (children.length > 0 && children.every((c) => c.attendsToday)) {
    const start = Math.max(...children.map((c) => c.schoolStartMinutes));
    const end = Math.min(...children.map((c) => c.schoolEndMinutes));
    if (end > start) schoolCover = { startMinutes: start, endMinutes: end };
  }

  // Minutes a supervisor-age sibling is at home: the whole day when they're
  // off school, or before and after school on a day they attend.
  const supervisorHome: DayInterval[] = [];
  if (rule.minSupervisorAge != null) {
    for (const child of children) {
      if (child.age == null || child.age < rule.minSupervisorAge) continue;
      if (child.attendsToday) {
        if (child.schoolStartMinutes > 0) {
          supervisorHome.push({ startMinutes: 0, endMinutes: child.schoolStartMinutes });
        }
        if (child.schoolEndMinutes < 1440) {
          supervisorHome.push({ startMinutes: child.schoolEndMinutes, endMinutes: 1440 });
        }
      } else {
        supervisorHome.push({ startMinutes: 0, endMinutes: 1440 });
      }
    }
  }

  // The household's narrower per-child rule: below strictPickupAge a sibling
  // can never stand in around that child's own drop-off/pick-up.
  let strictPickupWindows: DayInterval[] = [];
  if (rule.strictPickupAge != null) {
    for (const child of children) {
      if (child.age == null || child.age >= rule.strictPickupAge || !child.hasSchool) continue;
      strictPickupWindows = strictPickupWindows.concat(
        pickupDutyWindows({
          attendsSchoolToday: child.attendsToday,
          schoolStartMinutes: child.schoolStartMinutes,
          schoolEndMinutes: child.schoolEndMinutes,
          bufferMinutes: rule.pickupBufferMinutes,
        }),
      );
    }
  }

  // The broader rule: any school day's morning routine and pick-up needs an
  // actual adult, for every child who actually attends.
  const adultOnlyWindows = schoolRunAdultWindows({
    children: children.map((c) => ({
      hasSchool: c.hasSchool,
      attendsToday: c.attendsToday,
      schoolStartMinutes: c.schoolStartMinutes,
      schoolEndMinutes: c.schoolEndMinutes,
    })),
    morningFromMinutes: rule.schoolRunMorningFromMinutes,
    pickupBufferMinutes: rule.pickupBufferMinutes,
  });

  // Every school-linked child off for a recognised holiday/INSET/bank holiday
  // (not merely a weekend) means there's no school run to miss, so the
  // ordinary unattended allowance applies as it does at a weekend.
  const schoolLinked = children.filter((c) => c.hasSchool);
  const isSchoolHoliday =
    schoolLinked.length > 0 &&
    schoolLinked.every(
      (c) =>
        c.nonSchoolReasonKind === "BANK_HOLIDAY" ||
        c.nonSchoolReasonKind === "HOLIDAY" ||
        c.nonSchoolReasonKind === "INSET",
    );

  return {
    date,
    hasChildren: children.length > 0,
    schoolCover,
    supervisorHome: subtractIntervals(supervisorHome, strictPickupWindows),
    adultOnlyWindows,
    isSchoolHoliday,
  };
}

/** "HH:MM" to minutes past midnight; falls back to `fallback` when unset. */
export function minutesOrDefault(hhmm: string | null | undefined, fallback: string): number {
  const value = hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : fallback;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
