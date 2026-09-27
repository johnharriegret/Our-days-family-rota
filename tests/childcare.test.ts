import { test } from "node:test";
import assert from "node:assert/strict";
import { childcareStatus, uncoveredGaps } from "../src/lib/engine/childcare.ts";
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
