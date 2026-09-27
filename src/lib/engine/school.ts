import { dayOfWeek, isBetweenInclusive } from "./dates";
import { isBankHoliday } from "./bankHolidays";
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
