import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeDayIntervals,
  pickupDutyWindows,
  subtractIntervals,
  uncoveredGaps,
} from "../src/lib/engine/childcare.ts";

// The day-level interval helpers only. The household's childcare RULES used to
// be tested here against a single hand-built day; they now live in
// tests/timeline.test.ts, exercised over a continuous timeline assembled by the
// same functions the app itself uses. That matters: the old arrangement let a
// rule be asserted here while never actually firing in production.

test("uncoveredGaps merges overlapping intervals and finds the true gaps", () => {
  const gaps = uncoveredGaps([
    { startMinutes: 0, endMinutes: 480 },
    { startMinutes: 400, endMinutes: 600 },
    { startMinutes: 900, endMinutes: 1440 },
  ]);
  assert.deepEqual(gaps, [{ startMinutes: 600, endMinutes: 900 }]);
});

test("uncoveredGaps on an entirely uncovered day is the whole day", () => {
  assert.deepEqual(uncoveredGaps([]), [{ startMinutes: 0, endMinutes: 1440 }]);
});

test("mergeDayIntervals drops zero-length intervals and joins touching ones", () => {
  assert.deepEqual(
    mergeDayIntervals([
      { startMinutes: 100, endMinutes: 100 },
      { startMinutes: 0, endMinutes: 60 },
      { startMinutes: 60, endMinutes: 120 },
    ]),
    [{ startMinutes: 0, endMinutes: 120 }],
  );
});

// --- subtractIntervals -------------------------------------------------

test("subtractIntervals removes an overlapping middle chunk, leaving both sides", () => {
  const result = subtractIntervals(
    [{ startMinutes: 0, endMinutes: 100 }],
    [{ startMinutes: 30, endMinutes: 60 }],
  );
  assert.deepEqual(result, [
    { startMinutes: 0, endMinutes: 30 },
    { startMinutes: 60, endMinutes: 100 },
  ]);
});

test("subtractIntervals with no overlap leaves the original untouched", () => {
  const result = subtractIntervals([{ startMinutes: 0, endMinutes: 50 }], [{ startMinutes: 100, endMinutes: 150 }]);
  assert.deepEqual(result, [{ startMinutes: 0, endMinutes: 50 }]);
});

test("subtractIntervals can remove an interval entirely", () => {
  const result = subtractIntervals([{ startMinutes: 10, endMinutes: 20 }], [{ startMinutes: 0, endMinutes: 30 }]);
  assert.deepEqual(result, []);
});

test("subtractIntervals with nothing to subtract is a no-op", () => {
  const result = subtractIntervals([{ startMinutes: 10, endMinutes: 20 }], []);
  assert.deepEqual(result, [{ startMinutes: 10, endMinutes: 20 }]);
});

// --- pickupDutyWindows --------------------------------------------------

test("pickupDutyWindows gives a buffer before school start and after school end", () => {
  const windows = pickupDutyWindows({
    attendsSchoolToday: true,
    schoolStartMinutes: 9 * 60, // 09:00
    schoolEndMinutes: 15 * 60, // 15:00
    bufferMinutes: 30,
  });
  assert.deepEqual(windows, [
    { startMinutes: 510, endMinutes: 540 }, // 08:30-09:00
    { startMinutes: 900, endMinutes: 930 }, // 15:00-15:30
  ]);
});

test("pickupDutyWindows is empty when the child isn't at school that day", () => {
  const windows = pickupDutyWindows({
    attendsSchoolToday: false,
    schoolStartMinutes: 540,
    schoolEndMinutes: 900,
    bufferMinutes: 30,
  });
  assert.deepEqual(windows, []);
});

test("pickupDutyWindows clamps to the start of the day when school starts very early", () => {
  const windows = pickupDutyWindows({
    attendsSchoolToday: true,
    schoolStartMinutes: 15, // 00:15
    schoolEndMinutes: 900,
    bufferMinutes: 30,
  });
  assert.deepEqual(windows[0], { startMinutes: 0, endMinutes: 15 });
});

test("a supervisor-sibling allowance is unusable inside the pickup window but fine outside it", () => {
  // 13yo is home all day (supervisorHome = whole day), but the buffer around
  // school start/end must still require an adult - only an adult can do the
  // school run, regardless of who else is home.
  const pickupWindows = pickupDutyWindows({
    attendsSchoolToday: true,
    schoolStartMinutes: 540, // 09:00
    schoolEndMinutes: 900, // 15:00
    bufferMinutes: 30,
  });
  const restricted = subtractIntervals([{ startMinutes: 0, endMinutes: 1440 }], pickupWindows);
  // A gap from 08:45-09:15 (part of it inside the 08:30-09:00 pickup window)
  // must NOT be excusable by the sibling allowance.
  const gapDuringDropoff = { startMinutes: 525, endMinutes: 555 };
  const isWithin = (g: typeof gapDuringDropoff, intervals: typeof restricted) =>
    intervals.some((iv) => g.startMinutes >= iv.startMinutes && g.endMinutes <= iv.endMinutes);
  assert.equal(isWithin(gapDuringDropoff, restricted), false);
  // A gap from 18:00-19:00 (well outside both buffers) is still fine.
  const eveningGap = { startMinutes: 1080, endMinutes: 1140 };
  assert.equal(isWithin(eveningGap, restricted), true);
});
