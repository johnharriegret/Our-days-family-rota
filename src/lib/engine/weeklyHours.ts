import { addDays, dayOfWeek } from "./dates";
import type { PaidShiftRecord } from "./types";

/**
 * The Monday-or-whichever-day-configured that starts the week containing `date`.
 * weekStartsOn: 0 = Sunday .. 6 = Saturday (default 1 = Monday).
 */
export function weekStart(date: string, weekStartsOn = 1): string {
  const diff = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

/**
 * Hard per-week total: only shifts whose date falls within this single Mon-Sun
 * (or configured) week are counted. Weeks are never averaged against each other -
 * a light week and a heavy week each stand on their own.
 */
export function weeklyHours(
  weekStartDate: string,
  shifts: PaidShiftRecord[],
  requiredMinutes: number,
): { requiredMinutes: number; workedMinutes: number; remainingMinutes: number } {
  const weekEndExclusive = addDays(weekStartDate, 7);
  const workedMinutes = shifts
    .filter((s) => s.date >= weekStartDate && s.date < weekEndExclusive)
    .reduce((sum, s) => sum + s.paidMinutes, 0);
  return {
    requiredMinutes,
    workedMinutes,
    remainingMinutes: requiredMinutes - workedMinutes,
  };
}
