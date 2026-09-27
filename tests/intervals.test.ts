import { test } from "node:test";
import assert from "node:assert/strict";
import { localDateTimeToUtc, shiftToUtcInterval } from "../src/lib/engine/intervals.ts";

const TZ = "Europe/London";

test("an ordinary day shift is exactly 12 hours regardless of season", () => {
  const interval = shiftToUtcInterval(
    "2026-09-01",
    { startLocal: "06:00", endLocal: "18:00" },
    TZ,
  )!;
  const minutes = (interval.end.getTime() - interval.start.getTime()) / 60_000;
  assert.equal(minutes, 720);
});

test("an overnight shift is placed on the next calendar day", () => {
  const interval = shiftToUtcInterval(
    "2026-09-17",
    { startLocal: "18:00", endLocal: "06:00" },
    TZ,
  )!;
  assert.equal(interval.start.toISOString(), "2026-09-17T17:00:00.000Z"); // BST = UTC+1
  assert.equal(interval.end.toISOString(), "2026-09-18T05:00:00.000Z");
});

test("a night shift crossing the October clock-change gains a real hour", () => {
  // UK clocks go back 1 hour at 02:00 on the last Sunday of October (2026-10-25).
  const interval = shiftToUtcInterval(
    "2026-10-24",
    { startLocal: "18:00", endLocal: "06:00" },
    TZ,
  )!;
  const minutes = (interval.end.getTime() - interval.start.getTime()) / 60_000;
  assert.equal(minutes, 13 * 60);
});

test("a night shift crossing the March clock-change loses a real hour", () => {
  // UK clocks go forward 1 hour at 01:00 on the last Sunday of March (2027-03-28).
  const interval = shiftToUtcInterval(
    "2027-03-27",
    { startLocal: "18:00", endLocal: "06:00" },
    TZ,
  )!;
  const minutes = (interval.end.getTime() - interval.start.getTime()) / 60_000;
  assert.equal(minutes, 11 * 60);
});

test("localDateTimeToUtc round-trips a plain winter morning", () => {
  const utc = localDateTimeToUtc("2026-01-15", "08:45", TZ);
  assert.equal(utc.toISOString(), "2026-01-15T08:45:00.000Z"); // GMT = UTC+0
});
