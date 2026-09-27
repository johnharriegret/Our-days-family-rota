import { dayOfWeek, isBetweenInclusive, isWeekend } from "./dates";
import { bankHolidayLabel, isBankHoliday } from "./bankHolidays";
import type { SchoolTermSpec } from "./types";

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri

/**
 * True if `date` is a school day: inside a TERM block whose weekdays include
 * this day, and not overridden by a bank holiday / holiday / INSET block. A
 * term's `weekdays` (0=Sun..6=Sat, default Mon-Fri) lets a child attend only
 * certain days (e.g. a 3-year-old at nursery Tue/Wed/Thu only).
 */
export function isSchoolDay(date: string, terms: SchoolTermSpec[]): boolean {
  if (isBankHoliday(date)) return false;
  const covering = terms.filter((t) => isBetweenInclusive(date, t.startDate, t.endDate));
  if (covering.some((t) => t.type === "HOLIDAY" || t.type === "INSET" || t.type === "BANK_HOLIDAY")) {
    return false;
  }
  const dow = dayOfWeek(date);
  return covering.some((t) => t.type === "TERM" && (t.weekdays ?? DEFAULT_WEEKDAYS).includes(dow));
}

export type NonSchoolDayReason =
  | { kind: "BANK_HOLIDAY"; label: string }
  | { kind: "HOLIDAY"; label: string }
  | { kind: "INSET"; label: string }
  | { kind: "WEEKEND" }
  | { kind: "NOT_A_TERM_DAY" } // e.g. a Mon/Fri gap for a Tue-Wed-Thu-only nursery place
  | { kind: "UNKNOWN" }; // outside anything entered so far - not otherwise explained

/**
 * Explains WHY `date` isn't a school day, for display (e.g. "Home - Half
 * term" instead of a bare, undifferentiated "Home"). Returns null when it
 * actually IS a school day. Checked in the same priority order isSchoolDay
 * itself uses: a bank holiday is checked first, then a specific term block,
 * then whether it's simply a weekend.
 */
export function nonSchoolDayReason(date: string, terms: SchoolTermSpec[]): NonSchoolDayReason | null {
  if (isSchoolDay(date, terms)) return null;

  if (isBankHoliday(date)) {
    return { kind: "BANK_HOLIDAY", label: bankHolidayLabel(date) ?? "Bank holiday" };
  }
  const covering = terms.filter((t) => isBetweenInclusive(date, t.startDate, t.endDate));
  const holiday = covering.find((t) => t.type === "HOLIDAY");
  if (holiday) return { kind: "HOLIDAY", label: holiday.label };
  const inset = covering.find((t) => t.type === "INSET");
  if (inset) return { kind: "INSET", label: inset.label };

  if (isWeekend(date)) return { kind: "WEEKEND" };

  const dow = dayOfWeek(date);
  const isNonAttendanceDayOfATerm = covering.some(
    (t) => t.type === "TERM" && !(t.weekdays ?? DEFAULT_WEEKDAYS).includes(dow),
  );
  if (isNonAttendanceDayOfATerm) return { kind: "NOT_A_TERM_DAY" };

  return { kind: "UNKNOWN" };
}
