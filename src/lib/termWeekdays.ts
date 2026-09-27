export const DEFAULT_TERM_WEEKDAYS = [1, 2, 3, 4, 5];

/** A TERM with no valid attendance days means the usual Monday-Friday term. */
export function normaliseTermWeekdays(value: unknown): number[] {
  const weekdays = Array.isArray(value)
    ? value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  return weekdays.length > 0 ? weekdays : DEFAULT_TERM_WEEKDAYS;
}
