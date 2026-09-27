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
 * Samples the zone's offset at UTC-noon of that calendar date (a point in time
 * that is never inside the UK's 01:00-02:00 clock-change window) rather than at
 * the target time itself, so it never lands on an ambiguous or skipped local hour.
 * Shift boundaries in this app are always on the hour/half-hour outside that
 * window, so this approximation is exact for every real shift time.
 */
export function localDateTimeToUtc(
  date: string,
  timeLocal: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = timeLocal.split(":").map(Number);
  const referenceInstant = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = timeZoneOffsetMinutesAt(referenceInstant, timeZone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000);
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
