import { addDays, compareDates } from "./dates";

/**
 * Counts/lists dates in [fromDate, toDate] where `isBothOff(date)` is true.
 * `isBothOff` is supplied by the caller (which already knows how to resolve
 * both parents' patterns/manual shifts for a date) so this stays a pure,
 * engine-agnostic set operation.
 */
export function daysOffTogether(
  fromDate: string,
  toDate: string,
  isBothOff: (date: string) => boolean,
): string[] {
  const result: string[] = [];
  let d = fromDate;
  while (compareDates(d, toDate) <= 0) {
    if (isBothOff(d)) result.push(d);
    d = addDays(d, 1);
  }
  return result;
}

export function nextDayOffTogether(
  fromDate: string,
  isBothOff: (date: string) => boolean,
  maxLookaheadDays = 180,
): string | null {
  for (let i = 0; i <= maxLookaheadDays; i++) {
    const d = addDays(fromDate, i);
    if (isBothOff(d)) return d;
  }
  return null;
}
