import { test } from "node:test";
import assert from "node:assert/strict";
import { childcareStatus, pickupDutyWindows, subtractIntervals, uncoveredGaps } from "../src/lib/engine/childcare.ts";
import type { ChildcareRuleSpec } from "../src/lib/engine/types.ts";

const rule: ChildcareRuleSpec = {
  maxUnsupervisedMinutes: 180,
  appliesWeekends: true,
  minSupervisorAge: 13,
};

test("uncoveredGaps merges overlapping intervals and finds the true gaps", () => {
  const gaps = uncoveredGaps([
    { startMinutes: 0, endMinutes: 480 }, // 00:00-08:00 school/parent
    { startMinutes: 470, endMinutes: 915 }, // overlaps, extends to 15:15
  ]);
  assert.deepEqual(gaps, [{ startMinutes: 915, endMinutes: 1440 }]);
});

test("a fully covered day is SAFE", () => {
  const result = childcareStatus({
    date: "2026-09-08", // Tuesday
    coveredIntervals: [{ startMinutes: 0, endMinutes: 1440 }],
    supervisorHome: [],
    rule,
  });
  assert.equal(result.status, "SAFE");
});

test("a 2-hour weekday gap on a school day with no cover needs childcare", () => {
  // Both parents work 14:00-18:00 (840-1080), nothing else covers that window.
  const result = childcareStatus({
    date: "2026-09-08", // Tuesday, not a weekend, 13-year-old is at school
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 840 },
      { startMinutes: 1080, endMinutes: 1440 },
    ],
    supervisorHome: [],
    rule,
  });
  assert.equal(result.status, "CHILDCARE_NEEDED");
  assert.equal(result.gapStart, "14:00");
  assert.equal(result.gapEnd, "18:00");
});

test("a 2-hour morning handover gap on an ordinary school day needs childcare (hard rule)", () => {
  // HG's night shift ends 06:00, Mum's shift doesn't start until 08:00: a
  // 2-hour gap (360-480) that's well within the 3-hour allowance, but it's a
  // normal Thursday school day, so the kids still need help with school prep.
  const result = childcareStatus({
    date: "2026-09-10", // Thursday, ordinary school day
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 360 },
      { startMinutes: 480, endMinutes: 1440 },
    ],
    supervisorHome: [],
    rule,
  });
  assert.equal(result.status, "CHILDCARE_NEEDED");
  assert.equal(result.gapStart, "06:00");
  assert.equal(result.gapEnd, "08:00");
});

test("the same 2-hour handover gap is fine when it's a school holiday or bank holiday", () => {
  // Same gap, same weekday, but the kids have no school run to make - so it's
  // treated like a weekend gap and falls within the 3-hour allowance.
  const result = childcareStatus({
    date: "2026-09-10", // Thursday, but flagged as a school holiday/bank holiday
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 360 },
      { startMinutes: 480, endMinutes: 1440 },
    ],
    supervisorHome: [],
    rule,
    isSchoolHoliday: true,
  });
  assert.equal(result.status, "HANDOVER");
});

test("the same 4-hour gap is a conflict on a weekend (over the 3-hour allowance)", () => {
  const result = childcareStatus({
    date: "2026-09-06", // Sunday
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 840 },
      { startMinutes: 1080, endMinutes: 1440 },
    ],
    supervisorHome: [],
    rule,
  });
  // 4 hours > the 3-hour allowance even though it's a weekend.
  assert.equal(result.status, "CHILDCARE_NEEDED");
});

test("a 2-hour gap on a weekend is within the 3-hour allowance: HANDOVER", () => {
  const result = childcareStatus({
    date: "2026-09-06", // Sunday
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 960 }, // covered until 16:00
      { startMinutes: 1080, endMinutes: 1440 }, // covered again from 18:00
    ],
    supervisorHome: [],
    rule,
  });
  assert.equal(result.status, "HANDOVER");
});

test("a weekday gap is HANDOVER when the 13-year-old is home all day (INSET)", () => {
  const result = childcareStatus({
    date: "2026-09-08", // Tuesday, but the 13yo is on an INSET day / not at school
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 960 },
      { startMinutes: 1080, endMinutes: 1440 },
    ],
    supervisorHome: [{ startMinutes: 0, endMinutes: 1440 }],
    rule,
  });
  assert.equal(result.status, "HANDOVER");
});

test("an after-school gap is a HANDOVER once the 13-year-old is home from school", () => {
  // 9-4 shift: uncovered 15:15-16:00 (915-960). Emma is home from 15:15.
  const result = childcareStatus({
    date: "2026-09-08", // Tuesday (weekday, no weekend allowance)
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 915 },
      { startMinutes: 960, endMinutes: 1440 },
    ],
    supervisorHome: [{ startMinutes: 915, endMinutes: 1440 }], // home from 15:15
    rule,
  });
  assert.equal(result.status, "HANDOVER");
  assert.equal(result.gapStart, "15:15");
});

test("a gap before the supervisor gets home still needs childcare", () => {
  // Uncovered 07:00-08:45 (420-525) in the morning; the 13yo isn't home yet.
  const result = childcareStatus({
    date: "2026-09-08",
    coveredIntervals: [
      { startMinutes: 0, endMinutes: 420 },
      { startMinutes: 525, endMinutes: 1440 },
    ],
    supervisorHome: [{ startMinutes: 915, endMinutes: 1440 }],
    rule,
  });
  assert.equal(result.status, "CHILDCARE_NEEDED");
  assert.equal(result.gapStart, "07:00");
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
