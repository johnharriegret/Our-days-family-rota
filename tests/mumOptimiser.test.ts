import { test } from "node:test";
import assert from "node:assert/strict";
import { planMumWeek } from "../src/lib/engine/mumOptimiser.ts";
import type { MumShiftOption, OptimiserDay, OptimiserResult } from "../src/lib/engine/mumOptimiser.ts";
import { buildTimelineDay, type ChildDayInfo, type HouseholdRuleConfig } from "../src/lib/engine/householdDay.ts";
import { isWeekend } from "../src/lib/engine/dates.ts";

const TZ = "Europe/London";

const LONG_DAY: MumShiftOption = { id: "long", name: "Long Day", startLocal: "07:00", endLocal: "20:00", paidMinutes: 750 };
const EARLY: MumShiftOption = { id: "early", name: "Early", startLocal: "07:00", endLocal: "14:30", paidMinutes: 450 };
const SCHOOL_HOURS: MumShiftOption = { id: "nine4", name: "9-4", startLocal: "09:00", endLocal: "15:00", paidMinutes: 360 };
const NIGHT_SHIFT: MumShiftOption = { id: "night", name: "Night", startLocal: "20:00", endLocal: "08:00", paidMinutes: 720 };

const DAD_DAY = { startLocal: "06:00", endLocal: "18:00" };

const SCHOOL_START = 525; // 08:45
const SCHOOL_END = 915; // 15:15

const RULE: HouseholdRuleConfig = {
  maxUnsupervisedMinutes: 180,
  appliesWeekends: true,
  minSupervisorAge: 13,
  strictPickupAge: null,
  pickupBufferMinutes: 30,
  schoolRunMorningFromMinutes: 360,
};

/** The household as it really is on a date: school on weekdays, not at weekends. */
function realChildren(date: string): ChildDayInfo[] {
  const weekend = isWeekend(date);
  return [13, 3].map((age) => ({
    hasSchool: true,
    attendsToday: !weekend,
    schoolStartMinutes: SCHOOL_START,
    schoolEndMinutes: SCHOOL_END,
    age,
    nonSchoolReasonKind: weekend ? ("WEEKEND" as const) : null,
  }));
}

/** A day with nobody to look after - for the tests that are only about hours. */
function childlessDay(date: string): OptimiserDay {
  return {
    ...buildTimelineDay(date, [], RULE),
    hasChildren: false,
    dadKnown: true,
    dadShift: null,
    ownKnown: true,
    ownShift: null,
    locked: null,
  };
}

/** A day with the real household on it, school terms and all. */
function householdDay(date: string, over: Partial<OptimiserDay> = {}): OptimiserDay {
  return {
    ...buildTimelineDay(date, realChildren(date), RULE),
    hasChildren: true,
    dadKnown: true,
    dadShift: null,
    ownKnown: true,
    ownShift: null,
    locked: null,
    ...over,
  };
}

const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
const DAY_BEFORE = "2026-09-20";
const DAY_AFTER = "2026-09-28";

/**
 * Runs the optimiser over a proper window: the seven days being planned, plus
 * the context day either side whose shifts are already fixed. Every test goes
 * through this, because planning a bare seven days in isolation is the shape
 * that hid the Sunday-into-Monday bug in the first place.
 */
function plan(opts: {
  week?: OptimiserDay[];
  before?: OptimiserDay;
  after?: OptimiserDay;
  requiredMinutes: number;
  shiftOptions: MumShiftOption[];
  rule?: { maxUnsupervisedMinutes: number; appliesWeekends: boolean };
}): OptimiserResult {
  const week = opts.week ?? WEEK.map(childlessDay);
  const before = opts.before ?? childlessDay(DAY_BEFORE);
  const after = opts.after ?? childlessDay(DAY_AFTER);
  return planMumWeek({
    timeZone: TZ,
    days: [before, ...week, after],
    reportFrom: 1,
    reportTo: 7,
    requiredMinutes: opts.requiredMinutes,
    shiftOptions: opts.shiftOptions,
    rule: opts.rule ?? { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
}

// --- hours ---------------------------------------------------------------

test("hits the exact weekly hours with whole shifts", () => {
  const res = plan({ requiredMinutes: 2250, shiftOptions: [LONG_DAY] });
  assert.ok(res.best, "a plan should be produced");
  assert.equal(res.best.metrics.hoursExact, true);
  assert.equal(res.best.metrics.totalPaidMinutes, 2250);
  assert.equal(res.best.days.length, 7, "seven days are planned, not the context days");
  const working = res.best.days.filter((d) => d.option).length;
  assert.equal(working, 3, "three Long Days = 37.5h");
});

test("never changes a locked day and counts its hours", () => {
  const week = WEEK.map((d, i) =>
    i === 0
      ? { ...childlessDay(d), locked: { paidMinutes: 750, shift: { startLocal: "07:00", endLocal: "20:00" } } }
      : childlessDay(d),
  );
  const res = plan({ week, requiredMinutes: 2250, shiftOptions: [LONG_DAY] });
  assert.ok(res.best);
  assert.equal(res.best.days[0].locked, true);
  assert.equal(res.best.metrics.totalPaidMinutes, 2250);
  const nonLockedWorking = res.best.days.filter((d) => d.option && !d.locked).length;
  assert.equal(nonLockedWorking, 2);
});

test("falls back to the closest total when no exact combination exists", () => {
  const res = plan({ requiredMinutes: 2000, shiftOptions: [LONG_DAY] });
  assert.ok(res.best);
  assert.equal(res.best.metrics.hoursExact, false);
  // 2250 is 250 over; 1500 is 500 under - the nearer one wins.
  assert.equal(res.best.metrics.totalPaidMinutes, 2250);
});

test("reports a clear message when there are no shift types", () => {
  const res = plan({ requiredMinutes: 2250, shiftOptions: [] });
  assert.equal(res.best, null);
  assert.equal(res.bestWithConflicts, null);
  assert.match(res.message ?? "", /shift type/i);
});

test("is deterministic - same input, same plan", () => {
  const a = plan({ requiredMinutes: 2250, shiftOptions: [LONG_DAY, EARLY] });
  const b = plan({ requiredMinutes: 2250, shiftOptions: [LONG_DAY, EARLY] });
  assert.deepEqual(
    a.best?.days.map((d) => d.option?.id ?? null),
    b.best?.days.map((d) => d.option?.id ?? null),
  );
});

// --- time off together ---------------------------------------------------

test("prefers the day the other parent is off, avoiding a childcare conflict", () => {
  const week = WEEK.map((d, i) => householdDay(d, { dadShift: i === 0 ? null : DAD_DAY }));
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE, { dadShift: DAD_DAY }),
    after: householdDay(DAY_AFTER, { dadShift: DAD_DAY }),
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY],
  });
  assert.ok(res.best, "a safe plan exists: the Monday the other parent is home");
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.ok(res.best.days[0].option, "the shift goes on the day the other parent is off");
});

test("maximises couple time off: works when the other parent works and the kids are at school", () => {
  // Dad works Mon-Wed. A school-hours shift on one of those days costs the
  // couple nothing, and protects his days off later in the week.
  const week = WEEK.map((d, i) => householdDay(d, { dadShift: i <= 2 ? DAD_DAY : null }));
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE, { dadShift: DAD_DAY }),
    after: householdDay(DAY_AFTER),
    requiredMinutes: 360,
    shiftOptions: [SCHOOL_HOURS],
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0);
  const workedIndex = res.best.days.findIndex((d) => d.option);
  assert.ok(workedIndex >= 0 && workedIndex <= 2, "worked on a day he was working anyway");
  assert.equal(res.best.metrics.familyDaysTogether, 4, "all four of his days off stay shared");
});

// --- childcare as a hard constraint --------------------------------------

test("childcare outranks the hours: an exact week with a gap loses to an inexact week without one", () => {
  // Dad is on days all week. A Long Day (07:00-20:00) leaves the school run
  // uncovered at both ends; two 9-4s miss the hours by half an hour but are
  // safe. The safe one must win - under the old ranking hours came first, and
  // the unsafe plan was presented as the best fit.
  const week = WEEK.map((d) => householdDay(d, { dadShift: DAD_DAY }));
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE, { dadShift: DAD_DAY }),
    after: householdDay(DAY_AFTER, { dadShift: DAD_DAY }),
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY, SCHOOL_HOURS],
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0, "never offers a plan with a gap");
  assert.equal(res.best.metrics.hoursExact, false);
  assert.equal(res.best.metrics.totalPaidMinutes, 720, "two school-hours shifts");
  assert.equal(
    res.best.days.every((d) => !d.option || d.option.id === "nine4"),
    true,
  );
});

test("when the hours can only be worked by accepting a gap, the recommendation stays safe and the trade-off is named", () => {
  // Dad on days all week and only a Long Day available: any shift long enough
  // to reach the hours leaves the school run uncovered. The safe answer is to
  // work nothing, which is true but useless on its own - so the exact-hours
  // option is offered separately, clearly marked, and never as the best fit.
  const week = WEEK.map((d) => householdDay(d, { dadShift: DAD_DAY }));
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE, { dadShift: DAD_DAY }),
    after: householdDay(DAY_AFTER, { dadShift: DAD_DAY }),
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY],
  });
  assert.ok(res.best, "the recommendation is still a safe one");
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.ok(res.bestWithConflicts, "with the exact-hours option alongside it");
  assert.ok(res.bestWithConflicts.metrics.childcareConflicts > 0);
  assert.ok(res.bestWithConflicts.conflicts.length > 0, "and the actual gaps attached");
  assert.equal(res.bestWithConflicts.metrics.hoursExact, true);
  assert.match(res.message ?? "", /childcare gap/i);
});

test("no plan at all is offered when a locked day makes a gap unavoidable", () => {
  // Wednesday is locked to a Long Day while he is on days: the school run is
  // uncovered at both ends and the optimiser is not allowed to change a locked
  // day. Nothing it can choose elsewhere fixes it, so there is no safe plan.
  const week = WEEK.map((d, i) =>
    householdDay(d, {
      dadShift: DAD_DAY,
      locked:
        i === 2
          ? { paidMinutes: 750, shift: { startLocal: "07:00", endLocal: "20:00" }, label: "Long Day" }
          : null,
    }),
  );
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE, { dadShift: DAD_DAY }),
    after: householdDay(DAY_AFTER, { dadShift: DAD_DAY }),
    requiredMinutes: 750,
    shiftOptions: [SCHOOL_HOURS],
  });
  assert.equal(res.best, null, "an unsafe plan is never offered as the best fit");
  assert.ok(res.bestWithConflicts, "the closest option is still there to explain why");
  assert.ok(res.bestWithConflicts.conflicts.length > 0);
  assert.match(res.message ?? "", /no safe plan/i);
});

test("a gap the school-holiday allowance covers is not treated as a conflict", () => {
  // The same shape, but it's half term: no school run to miss, so the
  // household's ordinary allowance applies and a plan becomes possible.
  const halfTermChildren = (): ChildDayInfo[] =>
    [13, 3].map((age) => ({
      hasSchool: true,
      attendsToday: false,
      schoolStartMinutes: SCHOOL_START,
      schoolEndMinutes: SCHOOL_END,
      age,
      nonSchoolReasonKind: "HOLIDAY" as const,
    }));
  const holidayDay = (date: string, over: Partial<OptimiserDay> = {}): OptimiserDay => ({
    ...buildTimelineDay(date, halfTermChildren(), RULE),
    hasChildren: true,
    dadKnown: true,
    dadShift: null,
    ownKnown: true,
    ownShift: null,
    locked: null,
    ...over,
  });
  const halfTerm = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  const res = planMumWeek({
    timeZone: TZ,
    days: [
      holidayDay("2026-10-25"),
      ...halfTerm.map((d) => holidayDay(d, { dadShift: { startLocal: "09:00", endLocal: "17:00" } })),
      holidayDay("2026-11-02"),
    ],
    reportFrom: 1,
    reportTo: 7,
    requiredMinutes: 360,
    shiftOptions: [SCHOOL_HOURS],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
  });
  assert.ok(res.best, "a 9-4 alongside his 9-5 is fine in the holidays");
  assert.equal(res.best.metrics.childcareConflicts, 0);
});

// --- the week boundary ---------------------------------------------------

test("never suggests a Sunday night that would clash with the following Monday", () => {
  // He's off all week but back on days the Monday after. A Sunday night shift
  // would run to 08:00 on that Monday, leaving the school run uncovered - a
  // conflict on a day belonging to the NEXT week's card. The optimiser must
  // place the night elsewhere rather than propose it.
  const week = WEEK.map((d) => householdDay(d));
  const res = plan({
    week,
    before: householdDay(DAY_BEFORE),
    after: householdDay(DAY_AFTER, { dadShift: DAD_DAY }),
    requiredMinutes: 720,
    shiftOptions: [NIGHT_SHIFT],
  });
  assert.ok(res.best);
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.equal(res.best.days[6].option, null, "the Sunday night is not proposed");
  assert.ok(
    res.best.days.some((d) => d.option?.id === "night"),
    "the night is placed on a day that works instead",
  );
});

// --- rest between shifts -------------------------------------------------

test("never suggests a night shift immediately followed by a long day (no rest, even overlaps)", () => {
  const res = plan({ requiredMinutes: 1470, shiftOptions: [NIGHT_SHIFT, LONG_DAY] });
  assert.ok(res.best);
  const ids = res.best.days.map((d) => d.option?.id ?? null);
  for (let i = 0; i < ids.length - 1; i++) {
    assert.ok(!(ids[i] === "night" && ids[i + 1] === "long"), `night into long day at index ${i}`);
  }
});

test("two consecutive night shifts ARE allowed (12h rest between them)", () => {
  const res = plan({ requiredMinutes: 1440, shiftOptions: [NIGHT_SHIFT] });
  assert.ok(res.best);
  assert.equal(res.best.metrics.totalPaidMinutes, 1440);
  assert.equal(res.best.days.filter((d) => d.option).length, 2);
});

test("respects minimum rest against a shift worked the day before the week starts", () => {
  const res = plan({
    before: { ...childlessDay(DAY_BEFORE), ownShift: { startLocal: "20:00", endLocal: "08:00" } },
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY],
  });
  assert.ok(res.best);
  assert.equal(res.best.days[0].option, null, "Monday can't be a Long Day after Sunday's night shift");
});

test("respects minimum rest against a shift already saved for the day AFTER the week", () => {
  // She is already down for a Long Day starting 07:00 on the following Monday,
  // so a Sunday night running to 08:00 is impossible. The trailing context day
  // is what makes this visible at all.
  const res = plan({
    after: { ...childlessDay(DAY_AFTER), ownShift: { startLocal: "07:00", endLocal: "20:00" } },
    requiredMinutes: 720,
    shiftOptions: [NIGHT_SHIFT],
  });
  assert.ok(res.best);
  assert.equal(res.best.days[6].option, null, "no Sunday night into Monday's long day");
});

test("respects minimum rest against a LOCKED shift the day after", () => {
  const week = WEEK.map((d, i) =>
    i === 2
      ? {
          ...childlessDay(d),
          locked: { paidMinutes: 750, shift: { startLocal: "07:00", endLocal: "20:00" }, label: "Long Day" },
        }
      : childlessDay(d),
  );
  const res = plan({ week, requiredMinutes: 1470, shiftOptions: [NIGHT_SHIFT, LONG_DAY] });
  assert.ok(res.best);
  assert.equal(res.best.days[1].option, null, "no night shift the evening before a locked long day");
});
