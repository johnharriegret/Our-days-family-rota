import { test } from "node:test";
import assert from "node:assert/strict";
import { planMumWeek } from "../src/lib/engine/mumOptimiser.ts";
import type { MumShiftOption, OptimiserDay } from "../src/lib/engine/mumOptimiser.ts";

const LONG_DAY: MumShiftOption = { id: "long", name: "Long Day", startLocal: "07:00", endLocal: "20:00", paidMinutes: 750 };
const EARLY: MumShiftOption = { id: "early", name: "Early", startLocal: "07:00", endLocal: "14:30", paidMinutes: 450 };

function plainDay(date: string, over: Partial<OptimiserDay> = {}): OptimiserDay {
  return {
    date,
    isWeekend: false,
    hasChildren: false,
    dadKnown: true,
    dadShift: null,
    locked: null,
    schoolCover: null,
    supervisorHomeAllowance: false,
    ...over,
  };
}

const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

test("hits the exact weekly hours with whole shifts", () => {
  const res = planMumWeek({
    days: WEEK.map((d) => plainDay(d)),
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 2250,
    shiftOptions: [LONG_DAY],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best, "a plan should be produced");
  assert.equal(res.best.metrics.hoursExact, true);
  assert.equal(res.best.metrics.totalPaidMinutes, 2250);
  const working = res.best.days.filter((d) => d.option).length;
  assert.equal(working, 3, "three Long Days = 37.5h");
});

test("never changes a locked day and counts its hours", () => {
  const days = WEEK.map((d, i) =>
    i === 0 ? plainDay(d, { locked: { paidMinutes: 750, shift: { startLocal: "07:00", endLocal: "20:00" } } }) : plainDay(d),
  );
  const res = planMumWeek({
    days,
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 2250,
    shiftOptions: [LONG_DAY],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best);
  assert.equal(res.best.days[0].locked, true);
  assert.equal(res.best.metrics.totalPaidMinutes, 2250);
  // locked day (750) + two more Long Days (1500) = 2250
  const nonLockedWorking = res.best.days.filter((d) => d.option && !d.locked).length;
  assert.equal(nonLockedWorking, 2);
});

test("prefers the day the other parent is off, avoiding a childcare conflict", () => {
  // Two weekend days, children home. Day 0 the other parent is off; day 1 they
  // work 06:00-18:00. Working the single shift on day 0 keeps a parent home.
  const days: OptimiserDay[] = [
    plainDay("2026-09-26", { isWeekend: true, hasChildren: true, dadShift: null }),
    plainDay("2026-09-27", { isWeekend: true, hasChildren: true, dadShift: { startLocal: "06:00", endLocal: "18:00" } }),
  ];
  const res = planMumWeek({
    days,
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.ok(res.best.days[0].option, "should work the day the other parent is off");
  assert.equal(res.best.days[1].option, null);
});

test("falls back to the closest total when no exact combination exists", () => {
  // Required 2250 but only a 450-minute shift: 5x450 = 2250 is exact actually,
  // so use a required that 450 can't divide: 2000. Closest is 1800 or 2250-ish.
  const res = planMumWeek({
    days: WEEK.map((d) => plainDay(d)),
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 2000,
    shiftOptions: [EARLY],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.hoursExact, false);
  // within one shift of target
  assert.ok(Math.abs(res.best.metrics.totalPaidMinutes - 2000) <= 450);
});

test("reports a clear message when there are no shift types", () => {
  const res = planMumWeek({
    days: WEEK.map((d) => plainDay(d)),
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 2250,
    shiftOptions: [],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.equal(res.best, null);
  assert.match(res.message ?? "", /shift type/i);
});

test("is deterministic - same input, same plan", () => {
  const input = {
    days: WEEK.map((d) => plainDay(d)),
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 2250,
    shiftOptions: [LONG_DAY, EARLY],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  };
  const a = planMumWeek(input);
  const b = planMumWeek(input);
  assert.deepEqual(
    a.best?.days.map((d) => d.option?.id ?? null),
    b.best?.days.map((d) => d.option?.id ?? null),
  );
});
