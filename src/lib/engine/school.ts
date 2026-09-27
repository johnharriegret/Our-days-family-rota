import { isBetweenInclusive, isWeekend } from "./dates";
import { isBankHoliday } from "./bankHolidays";
import type { SchoolTermSpec } from "./types";

/** True if `date` falls inside a TERM block and isn't a weekend/bank holiday/INSET day. */
export function isSchoolDay(date: string, terms: SchoolTermSpec[]): boolean {
  if (isWeekend(date)) return false;
  if (isBankHoliday(date)) return false;
  const covering = terms.filter((t) => isBetweenInclusive(date, t.startDate, t.endDate));
  if (covering.some((t) => t.type === "HOLIDAY" || t.type === "INSET" || t.type === "BANK_HOLIDAY")) {
    return false;
  }
  return covering.some((t) => t.type === "TERM");
}
