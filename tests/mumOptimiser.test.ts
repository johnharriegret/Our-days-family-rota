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
    supervisorHome: [],
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

test("maximises couple time off: works when the other parent works and kids are at school", () => {
  // A shift that fits inside school hours (09:00-14:00). Working it on the day
  // the other parent ALSO works (kids covered by school) keeps both of the
  // other-parent's days off free for the couple, instead of using one up.
  const SCHOOL = { startMinutes: 9 * 60, endMinutes: 15 * 60 };
  const inSchool: MumShiftOption = { id: "sch", name: "School hours", startLocal: "09:00", endLocal: "14:00", paidMinutes: 300 };
  const days: OptimiserDay[] = [
    plainDay("2026-09-22", { hasChildren: true, schoolCover: SCHOOL, dadShift: null }),
    plainDay("2026-09-23", { hasChildren: true, schoolCover: SCHOOL, dadShift: { startLocal: "09:00", endLocal: "15:00" } }),
    plainDay("2026-09-24", { hasChildren: true, schoolCover: SCHOOL, dadShift: null }),
  ];
  const res = planMumWeek({
    days,
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 300,
    shiftOptions: [inSchool],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.equal(res.best.metrics.coupleDaytimeOff, 2, "both of the other parent's days off stay free");
  assert.ok(res.best.days[1].option, "should work the day the other parent also works");
  assert.equal(res.best.days[0].option, null);
  assert.equal(res.best.days[2].option, null);
});

test("works a school-hours shift on the OTHER parent's working days to free up their days off", () => {
  // Kids at school 08:45-15:15 every weekday; the 13yo is home before/after.
  // A 09:00-16:00 shift ends 45 min after pickup, covered by the 13yo (handover).
  const SCHOOL = { startMinutes: 525, endMinutes: 915 };
  const SUP = [
    { startMinutes: 0, endMinutes: 525 },
    { startMinutes: 915, endMinutes: 1440 },
  ];
  const nineToFour = { id: "94", name: "9-4", startLocal: "09:00", endLocal: "16:00", paidMinutes: 420 };
  // Dad works Mon/Tue/Wed, off Thu/Fri.
  const dad = (working: boolean) => (working ? { startLocal: "06:00", endLocal: "18:00" } : null);
  const days: OptimiserDay[] = [
    plainDay("2026-09-21", { hasChildren: true, schoolCover: SCHOOL, supervisorHome: SUP, dadShift: dad(true) }),
    plainDay("2026-09-22", { hasChildren: true, schoolCover: SCHOOL, supervisorHome: SUP, dadShift: dad(true) }),
    plainDay("2026-09-23", { hasChildren: true, schoolCover: SCHOOL, supervisorHome: SUP, dadShift: dad(true) }),
    plainDay("2026-09-24", { hasChildren: true, schoolCover: SCHOOL, supervisorHome: SUP, dadShift: dad(false) }),
    plainDay("2026-09-25", { hasChildren: true, schoolCover: SCHOOL, supervisorHome: SUP, dadShift: dad(false) }),
  ];
  const res = planMumWeek({
    days,
    priorDadShift: null,
    priorMumShift: null,
    requiredMinutes: 1260, // three 9-4 shifts
    shiftOptions: [nineToFour],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0);
  // Both of the other parent's days off (Thu/Fri) stay free for the couple.
  assert.equal(res.best.metrics.coupleDaytimeOff, 2);
  assert.equal(res.best.days[3].option, null); // Thu off
  assert.equal(res.best.days[4].option, null); // Fri off
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
