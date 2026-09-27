import { test } from "node:test";
import assert from "node:assert/strict";
import { awayIntervalsForDay, homeIntervalsForDay } from "../src/lib/engine/coverage.ts";

test("a day shift makes the person away only during the shift", () => {
  assert.deepEqual(awayIntervalsForDay({ startLocal: "06:00", endLocal: "18:00" }, null), [
    { startMinutes: 360, endMinutes: 1080 },
  ]);
});

test("an overnight shift runs to midnight on its own day", () => {
  assert.deepEqual(awayIntervalsForDay({ startLocal: "18:00", endLocal: "06:00" }, null), [
    { startMinutes: 1080, endMinutes: 1440 },
  ]);
});

test("last night's overnight shift makes the person away this morning", () => {
  // No shift today, but yesterday's 18:00-06:00 night spills into 00:00-06:00.
  assert.deepEqual(awayIntervalsForDay(null, { startLocal: "18:00", endLocal: "06:00" }), [
    { startMinutes: 0, endMinutes: 360 },
  ]);
});

test("a normal daytime shift yesterday does not affect today", () => {
  assert.deepEqual(awayIntervalsForDay(null, { startLocal: "09:00", endLocal: "17:00" }), []);
});

test("home time is the complement of away time (day shift)", () => {
  assert.deepEqual(homeIntervalsForDay({ startLocal: "06:00", endLocal: "18:00" }, null), [
    { startMinutes: 0, endMinutes: 360 },
    { startMinutes: 1080, endMinutes: 1440 },
  ]);
});

test("home time after a night shift ends is the rest of the morning onward", () => {
  // Yesterday 18:00-06:00 means away 00:00-06:00 today, so home 06:00-24:00.
  assert.deepEqual(homeIntervalsForDay(null, { startLocal: "18:00", endLocal: "06:00" }), [
    { startMinutes: 360, endMinutes: 1440 },
  ]);
});

test("fully off day is home all day", () => {
  assert.deepEqual(homeIntervalsForDay(null, null), [{ startMinutes: 0, endMinutes: 1440 }]);
});
