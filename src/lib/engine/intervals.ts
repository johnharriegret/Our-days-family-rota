import { addDays } from "./dates";
import type { UtcInterval } from "./types";

/**
 * The UTC offset (in minutes, positive = ahead of UTC) that `timeZone` observes
 * at the given instant. Uses Intl's `longOffset` name, which already accounts
 * for DST for that specific instant — no manual BST/GMT date-range table needed.
 */
export function timeZoneOffsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(raw);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  return (hours < 0 ? -1 : 1) * (Math.abs(hours) * 60 + minutes);
}

/**
 * Converts a local wall-clock date+time in `timeZone` to a UTC instant.
 *
 * Resolved in two passes, because the offset that applies depends on the very
 * instant being calculated: guess by reading the offset as if the wall-clock
 * reading were already UTC, then re-read the offset at that guess and correct.
 * Two passes is always enough for a zone whose offset changes by an hour.
 *
 * An earlier version sampled the offset once, at UTC noon of the same date, on
 * the reasoning that noon is never inside the clock-change window. That is true
 * of noon but not of the times being converted: 00:30 on the morning the clocks
 * go forward is still GMT while noon that day is already BST, so a gap from
 * 00:30 to 03:30 measured three hours when only two were lived through. On the
 * two days a year it matters, that hour is the difference between a childcare
 * gap being within the household's allowance and over it.
 */
export function localDateTimeToUtc(
  date: string,
  timeLocal: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = timeLocal.split(":").map(Number);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = asIfUtc - timeZoneOffsetMinutesAt(new Date(asIfUtc), timeZone) * 60_000;
  const corrected = asIfUtc - timeZoneOffsetMinutesAt(new Date(firstGuess), timeZone) * 60_000;
  return new Date(corrected);
}

/**
 * Turns a resolved shift's local start/end for a specific calendar date into a
 * concrete UTC interval. When end <= start the shift is treated as overnight,
 * ending on the following calendar date.
 */
export function shiftToUtcInterval(
  date: string,
  shift: { startLocal: string | null; endLocal: string | null },
  timeZone: string,
): UtcInterval | null {
  if (!shift.startLocal || !shift.endLocal) return null;
  const start = localDateTimeToUtc(date, shift.startLocal, timeZone);
  let end = localDateTimeToUtc(date, shift.endLocal, timeZone);
  if (end.getTime() <= start.getTime()) {
    end = localDateTimeToUtc(addDays(date, 1), shift.endLocal, timeZone);
  }
  return { start, end };
}
