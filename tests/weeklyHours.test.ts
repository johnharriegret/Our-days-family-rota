import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, weeklyHours } from "../src/lib/engine/weeklyHours.ts";

test("weekStart finds the Monday on or before a given date", () => {
  assert.equal(weekStart("2026-09-09"), "2026-09-07"); // Wednesday -> Monday
  assert.equal(weekStart("2026-09-07"), "2026-09-07"); // Monday itself
  assert.equal(weekStart("2026-09-13"), "2026-09-07"); // Sunday -> preceding Monday
});

test("37.5h/week is checked independently per week, never averaged", () => {
  const REQUIRED = 37.5 * 60;
  const shifts = [
    { date: "2026-09-07", paidMinutes: 750 }, // long day, week 1
    { date: "2026-09-08", paidMinutes: 750 },
    { date: "2026-09-09", paidMinutes: 750 }, // 2250 = exactly 37.5h in week 1
    { date: "2026-09-14", paidMinutes: 750 }, // only one shift in week 2
  ];
  const week1 = weeklyHours(weekStart("2026-09-09"), shifts, REQUIRED);
  const week2 = weeklyHours(weekStart("2026-09-14"), shifts, REQUIRED);

  assert.equal(week1.workedMinutes, 2250);
  assert.equal(week1.remainingMinutes, 0);
  assert.equal(week2.workedMinutes, 750);
  assert.equal(week2.remainingMinutes, REQUIRED - 750);
  // A surplus in week 1 must not offset week 2's shortfall.
  assert.ok(week2.remainingMinutes > 0, "week 2 must still show a shortfall");
});
