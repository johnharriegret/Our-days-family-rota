// Shared date-string helpers. Every date arithmetic operation anchors to UTC noon
// so it never trips over a local-timezone day boundary — this file has nothing to
// do with wall-clock shift times (see intervals.ts for that).

const DAY_MS = 86_400_000;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function dayDiff(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS,
  );
}

/** 0 = Sunday .. 6 = Saturday, independent of local timezone. */
export function dayOfWeek(date: string): number {
  return new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetweenInclusive(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
