import test from "node:test";
import assert from "node:assert/strict";
import {
  awaySpansFor,
  evaluateTimeline,
  schoolRunAdultWindows,
  type AdultDay,
  type TimelineResult,
} from "../src/lib/engine/timeline.ts";
import { buildTimelineDay, type ChildDayInfo, type HouseholdRuleConfig } from "../src/lib/engine/householdDay.ts";

// These tests deliberately build each day through `buildTimelineDay`, the same
// function the live calendar and the planner use, rather than hand-feeding the
// validator tidy intervals. An earlier version of this suite hand-fed its
// inputs and so asserted a rule that never actually fired in production: the
// test passed while the app said the opposite. Going through the real builder
// is what stops that happening again.

const TZ = "Europe/London";
const SCHOOL_START = 8 * 60 + 45; // 08:45
const SCHOOL_END = 15 * 60 + 15; // 15:15

const RULE: HouseholdRuleConfig = {
  maxUnsupervisedMinutes: 180, // the household's 3-hour allowance
  appliesWeekends: true,
  minSupervisorAge: 13, // the 13-year-old may supervise
  strictPickupAge: 5, // the 3-year-old's own school run needs an adult
  pickupBufferMinutes: 30,
  schoolRunMorningFromMinutes: 6 * 60, // 06:00: from here a school morning needs an adult
};

type DayKind = "SCHOOL" | "HOLIDAY" | "INSET" | "BANK_HOLIDAY" | "WEEKEND" | "NO_CHILDREN";

/** The household's real shape: a 13-year-old and a 3-year-old, same hours. */
function childrenFor(kind: DayKind): ChildDayInfo[] {
  if (kind === "NO_CHILDREN") return [];
  const attends = kind === "SCHOOL";
  const reason =
    kind === "SCHOOL"
      ? null
      : kind === "WEEKEND"
        ? ("WEEKEND" as const)
        : kind === "HOLIDAY"
          ? ("HOLIDAY" as const)
          : kind === "INSET"
            ? ("INSET" as const)
            : ("BANK_HOLIDAY" as const);
  return [13, 3].map((age) => ({
    hasSchool: true,
    attendsToday: attends,
    schoolStartMinutes: SCHOOL_START,
    schoolEndMinutes: SCHOOL_END,
    age,
    nonSchoolReasonKind: reason,
  }));
}

type Shift = { startLocal: string; endLocal: string } | null;

function run(opts: {
  days: { date: string; kind: DayKind }[];
  dad: Shift[];
  mum: Shift[];
  /** defaults to "everything except the first and last day". */
  reportFrom?: number;
  reportTo?: number;
  rule?: Partial<HouseholdRuleConfig>;
}): TimelineResult {
  const rule = { ...RULE, ...opts.rule };
  const days = opts.days.map((d) => buildTimelineDay(d.date, childrenFor(d.kind), rule));
  const toAdultDays = (shifts: Shift[]): AdultDay[] => shifts.map((shift) => ({ known: true, shift }));
  const reportFrom = opts.reportFrom ?? (opts.days.length > 2 ? 1 : 0);
  const reportTo = opts.reportTo ?? (opts.days.length > 2 ? opts.days.length - 2 : opts.days.length - 1);
  return evaluateTimeline({
    timeZone: TZ,
    days,
    adults: [toAdultDays(opts.dad), toAdultDays(opts.mum)],
    rule: { maxUnsupervisedMinutes: rule.maxUnsupervisedMinutes, appliesWeekends: rule.appliesWeekends },
    reportFrom,
    reportTo,
  });
}

const DAY = { startLocal: "06:00", endLocal: "18:00" };
const NIGHT = { startLocal: "20:00", endLocal: "08:00" };
const NINE_TO_FIVE = { startLocal: "09:00", endLocal: "17:00" };

// --- a shift is one continuous span, not two half-days ------------------

test("an overnight shift is a single continuous span across midnight", () => {
  const spans = awaySpansFor([
    { known: true, shift: null },
    { known: true, shift: NIGHT },
    { known: true, shift: null },
  ]);
  // day 1 at 20:00 = 1440 + 1200 = 2640, through to day 2 at 08:00 = 2880 + 480 = 3360.
  assert.deepEqual(spans, [{ start: 2640, end: 3360 }]);
  assert.equal(spans[0].end - spans[0].start, 720, "12 hours, in one piece");
});

test("consecutive nights neither lose nor duplicate their post-midnight hours", () => {
  const spans = awaySpansFor([
    { known: true, shift: NIGHT },
    { known: true, shift: NIGHT },
    { known: true, shift: null },
  ]);
  assert.equal(spans.length, 2);
  assert.deepEqual(
    spans.map((s) => s.end - s.start),
    [720, 720],
  );
  // The first night ends at 08:00 on day 1 and the second starts at 20:00 the
  // same day: a real 12-hour break, not a merged or duplicated block.
  assert.equal(spans[1].start - spans[0].end, 720);
});

// --- TEST 3 / TEST 6 / TEST 7: a school day is not covered all day ------

test("TEST 3 - husband DAY + wife NIGHT is rejected for the school morning, even under 3 hours", () => {
  // Wife's night (from the evening before) ends 08:00; husband left at 06:00.
  // 06:00-08:00 is only two hours, well inside the 3-hour allowance, and the
  // 13-year-old is at home - but somebody has to get the children up and take
  // them to school, so it must still be a conflict.
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" }, // Wednesday, context
      { date: "2026-09-10", kind: "SCHOOL" }, // Thursday, reported
      { date: "2026-09-11", kind: "SCHOOL" }, // Friday, context
    ],
    dad: [null, DAY, null],
    mum: [NIGHT, null, null],
  });
  assert.equal(result.conflicts.length, 1);
  const gap = result.conflicts[0];
  assert.equal(gap.startLocal, "06:00");
  assert.equal(gap.endLocal, "08:00");
  assert.equal(gap.elapsedMinutes, 120);
  assert.ok(gap.rejections.includes("SCHOOL_RUN"), "rejected for the school run specifically");
  assert.equal(result.byDate["2026-09-10"]?.status, "CHILDCARE_NEEDED");
  assert.match(gap.explanation, /ready for school|collected/);
});

test("TEST 4 - husband NIGHT + wife DAY is NOT rejected when the cover genuinely works", () => {
  // The reverse combination. He's home from 08:00 until he leaves at 20:00, so
  // he does the school run both ends; she covers the night's end before 09:00.
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" },
      { date: "2026-09-10", kind: "SCHOOL" },
      { date: "2026-09-11", kind: "SCHOOL" },
    ],
    dad: [NIGHT, NIGHT, null],
    mum: [null, NINE_TO_FIVE, null],
  });
  assert.deepEqual(result.conflicts, [], "this shape must not be rejected out of hand");
  assert.equal(result.byDate["2026-09-10"]?.status, "SAFE");
});

test("TEST 5 - an overlap entirely inside school hours is fine", () => {
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" },
      { date: "2026-09-10", kind: "SCHOOL" },
      { date: "2026-09-11", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "09:00", endLocal: "15:00" }, null],
    mum: [null, { startLocal: "09:00", endLocal: "15:00" }, null],
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.byDate["2026-09-10"]?.status, "SAFE");
});

test("TEST 6 - an overlap crossing school start is rejected for the part before school", () => {
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" },
      { date: "2026-09-10", kind: "SCHOOL" },
      { date: "2026-09-11", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "06:00", endLocal: "10:00" }, null],
    mum: [null, { startLocal: "06:00", endLocal: "10:00" }, null],
  });
  assert.equal(result.conflicts.length, 1);
  // School coverage starts at 08:45, so the gap ends there - the later part of
  // the overlap is genuinely covered and must not be reported as uncovered.
  assert.equal(result.conflicts[0].startLocal, "06:00");
  assert.equal(result.conflicts[0].endLocal, "08:45");
  assert.equal(result.byDate["2026-09-10"]?.status, "CHILDCARE_NEEDED");
});

test("TEST 7 - an after-school overlap is rejected, and the 3-hour rule does not rescue it", () => {
  // 15:15-18:00 is 2h45m, inside the allowance, and the 13-year-old is home.
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" },
      { date: "2026-09-10", kind: "SCHOOL" },
      { date: "2026-09-11", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "08:00", endLocal: "18:00" }, null],
    mum: [null, { startLocal: "08:00", endLocal: "18:00" }, null],
  });
  const afterSchool = result.conflicts.find((c) => c.startLocal === "15:15");
  assert.ok(afterSchool, "the after-school gap must be reported");
  assert.ok(afterSchool.rejections.includes("SCHOOL_RUN"));
  assert.equal(result.byDate["2026-09-10"]?.status, "CHILDCARE_NEEDED");
});

// --- the allowance, and where it does and does not apply ----------------

test("TEST 8 - a 2-hour gap at the weekend is within the allowance", () => {
  const result = run({
    days: [
      { date: "2026-09-04", kind: "SCHOOL" },
      { date: "2026-09-05", kind: "WEEKEND" }, // Saturday
      { date: "2026-09-07", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "14:00", endLocal: "16:00" }, null],
    mum: [null, { startLocal: "14:00", endLocal: "16:00" }, null],
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.byDate["2026-09-05"]?.status, "HANDOVER");
});

test("TEST 9 - three hours and one minute at the weekend is too long, to the minute", () => {
  const result = run({
    days: [
      { date: "2026-09-04", kind: "SCHOOL" },
      { date: "2026-09-05", kind: "WEEKEND" },
      { date: "2026-09-07", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "13:59", endLocal: "17:00" }, null],
    mum: [null, { startLocal: "13:59", endLocal: "17:00" }, null],
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].elapsedMinutes, 181, "not rounded down to three hours");
  assert.ok(result.conflicts[0].rejections.includes("TOO_LONG"));
});

test("TEST 10 - a 2-hour gap on a school-holiday weekday is allowed", () => {
  const result = run({
    days: [
      { date: "2026-10-26", kind: "HOLIDAY" },
      { date: "2026-10-27", kind: "HOLIDAY" }, // Tuesday, half term
      { date: "2026-10-28", kind: "HOLIDAY" },
    ],
    dad: [null, { startLocal: "10:00", endLocal: "12:00" }, null],
    mum: [null, { startLocal: "10:00", endLocal: "12:00" }, null],
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.byDate["2026-10-27"]?.status, "HANDOVER");
});

test("TEST 11 - an INSET day inside term time gets no school coverage", () => {
  // Both parents out 10:00-14:00: squarely inside school hours, so if the day
  // were wrongly treated as an ordinary school day this would look covered.
  const result = run({
    days: [
      { date: "2026-09-07", kind: "SCHOOL" },
      { date: "2026-09-08", kind: "INSET" },
      { date: "2026-09-09", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "10:00", endLocal: "14:00" }, null],
    mum: [null, { startLocal: "10:00", endLocal: "14:00" }, null],
  });
  assert.equal(result.conflicts.length, 1, "school must not cover an INSET day");
  assert.equal(result.conflicts[0].elapsedMinutes, 240);
  assert.ok(result.conflicts[0].rejections.includes("TOO_LONG"));
});

test("TEST 12 - a weekday bank holiday does not inherit school coverage either", () => {
  const result = run({
    days: [
      { date: "2026-08-30", kind: "HOLIDAY" },
      { date: "2026-08-31", kind: "BANK_HOLIDAY" }, // August bank holiday Monday
      { date: "2026-09-01", kind: "HOLIDAY" },
    ],
    dad: [null, { startLocal: "10:00", endLocal: "14:00" }, null],
    mum: [null, { startLocal: "10:00", endLocal: "14:00" }, null],
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].elapsedMinutes, 240);
});

// --- midnight, week, month and year boundaries --------------------------

test("TEST 16 - an unattended stretch crossing midnight is ONE gap, and the allowance does not restart", () => {
  // Both parents out 21:00 until 03:00: six continuous hours. Judged a day at
  // a time this read as two three-hour gaps and both were allowed.
  const result = run({
    days: [
      { date: "2026-09-11", kind: "SCHOOL" },
      { date: "2026-09-12", kind: "WEEKEND" }, // Saturday
      { date: "2026-09-13", kind: "WEEKEND" }, // Sunday
      { date: "2026-09-14", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "21:00", endLocal: "03:00" }, null, null],
    mum: [null, { startLocal: "21:00", endLocal: "03:00" }, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.equal(result.conflicts.length, 1, "one gap, not two");
  const gap = result.conflicts[0];
  assert.equal(gap.elapsedMinutes, 360, "six hours, counted through midnight");
  assert.equal(gap.crossesMidnight, true);
  assert.equal(gap.startDate, "2026-09-12");
  assert.equal(gap.endDate, "2026-09-13");
  assert.ok(gap.rejections.includes("TOO_LONG"));
  // It is reported against both dates it touches, so neither day looks clean.
  assert.equal(result.byDate["2026-09-12"]?.status, "CHILDCARE_NEEDED");
  assert.equal(result.byDate["2026-09-13"]?.status, "CHILDCARE_NEEDED");
});

test("TEST 1 - a Sunday night shift running into Monday's day shift is detected across the week boundary", () => {
  // The headline case: these two days belong to different weekly cards.
  const result = run({
    days: [
      { date: "2026-09-12", kind: "WEEKEND" },
      { date: "2026-09-13", kind: "WEEKEND" }, // Sunday - end of one week
      { date: "2026-09-14", kind: "SCHOOL" }, // Monday - start of the next
      { date: "2026-09-15", kind: "SCHOOL" },
    ],
    dad: [null, null, DAY, null],
    mum: [null, NIGHT, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].startDate, "2026-09-14");
  assert.equal(result.conflicts[0].startLocal, "06:00");
  assert.equal(result.conflicts[0].endLocal, "08:00");
  assert.equal(result.byDate["2026-09-14"]?.status, "CHILDCARE_NEEDED");
});

test("TEST 2 - a Sunday night shift into a Monday OFF raises no false conflict", () => {
  const result = run({
    days: [
      { date: "2026-09-12", kind: "WEEKEND" },
      { date: "2026-09-13", kind: "WEEKEND" },
      { date: "2026-09-14", kind: "SCHOOL" },
      { date: "2026-09-15", kind: "SCHOOL" },
    ],
    dad: [null, null, null, null],
    mum: [null, NIGHT, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.byDate["2026-09-14"]?.status, "SAFE");
});

test("TEST 13 - a conflict across a month boundary is detected", () => {
  const result = run({
    days: [
      { date: "2026-11-29", kind: "WEEKEND" },
      { date: "2026-11-30", kind: "SCHOOL" }, // Monday, last day of November
      { date: "2026-12-01", kind: "SCHOOL" }, // Tuesday, first day of December
      { date: "2026-12-02", kind: "SCHOOL" },
    ],
    dad: [null, null, DAY, null],
    mum: [null, NIGHT, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].startDate, "2026-12-01");
  assert.equal(result.byDate["2026-12-01"]?.status, "CHILDCARE_NEEDED");
});

test("TEST 14 - childcare and shift continuity do not reset at the year boundary", () => {
  // 21:00 on 31 December to 03:00 on 1 January: one six-hour stretch.
  const result = run({
    days: [
      { date: "2027-12-30", kind: "HOLIDAY" },
      { date: "2027-12-31", kind: "HOLIDAY" }, // Friday
      { date: "2028-01-01", kind: "BANK_HOLIDAY" }, // Saturday, New Year's Day
      { date: "2028-01-02", kind: "HOLIDAY" },
    ],
    dad: [null, { startLocal: "21:00", endLocal: "03:00" }, null, null],
    mum: [null, { startLocal: "21:00", endLocal: "03:00" }, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].startDate, "2027-12-31");
  assert.equal(result.conflicts[0].endDate, "2028-01-01");
  assert.equal(result.conflicts[0].elapsedMinutes, 360);
});

// --- window edges -------------------------------------------------------

test("TEST 17 - a range starting mid-night-shift still knows about that morning", () => {
  // The reported range starts on the Monday; the night shift began on Sunday,
  // outside it. Without the leading context day the Monday morning looks free.
  const result = run({
    days: [
      { date: "2026-09-13", kind: "WEEKEND" }, // context only
      { date: "2026-09-14", kind: "SCHOOL" }, // first reported day
      { date: "2026-09-15", kind: "SCHOOL" },
    ],
    dad: [null, DAY, null],
    mum: [NIGHT, null, null],
    reportFrom: 1,
    reportTo: 1,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].startDate, "2026-09-14");
  assert.equal(result.conflicts[0].startLocal, "06:00");
});

test("TEST 18 - a range ending mid-overnight-shift still checks the morning after", () => {
  // The night shift is on the LAST reported day and runs into the morning
  // after, where the other parent is already committed to a day shift. That
  // morning belongs to the next week's card, and the conflict is still real.
  const result = run({
    days: [
      { date: "2026-09-12", kind: "WEEKEND" },
      { date: "2026-09-13", kind: "WEEKEND" }, // last reported day (a Sunday)
      { date: "2026-09-14", kind: "SCHOOL" }, // context only
    ],
    dad: [null, null, DAY],
    mum: [null, NIGHT, null],
    reportFrom: 1,
    reportTo: 1,
  });
  assert.equal(result.conflicts.length, 1, "the spill into the following morning must be seen");
  assert.equal(result.conflicts[0].startDate, "2026-09-14");
  assert.equal(result.conflicts[0].startLocal, "06:00");
});

// --- daylight saving ----------------------------------------------------

test("TEST 19 - a gap across the BST to GMT change is measured in real hours, not clock hours", () => {
  // The clocks go back at 02:00 on 25 October 2026, so 23:00 to 02:00 is FOUR
  // real hours despite reading as three on the clock. It must fail the 3-hour
  // allowance.
  const result = run({
    days: [
      { date: "2026-10-23", kind: "HOLIDAY" },
      { date: "2026-10-24", kind: "WEEKEND" }, // Saturday
      { date: "2026-10-25", kind: "WEEKEND" }, // Sunday - clocks go back
      { date: "2026-10-26", kind: "HOLIDAY" },
    ],
    dad: [null, { startLocal: "23:00", endLocal: "02:00" }, null, null],
    mum: [null, { startLocal: "23:00", endLocal: "02:00" }, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].elapsedMinutes, 240, "four real hours, not three");
  assert.ok(result.conflicts[0].rejections.includes("TOO_LONG"));
});

test("TEST 20 - a gap across the GMT to BST change is likewise measured in real hours", () => {
  // The clocks go forward at 01:00 on 28 March 2027, so 00:30 to 03:30 is only
  // TWO real hours and stays inside the allowance.
  const result = run({
    days: [
      { date: "2027-03-26", kind: "HOLIDAY" },
      { date: "2027-03-27", kind: "WEEKEND" }, // Saturday
      { date: "2027-03-28", kind: "WEEKEND" }, // Sunday - clocks go forward
      { date: "2027-03-29", kind: "HOLIDAY" },
    ],
    dad: [null, { startLocal: "22:00", endLocal: "03:30" }, null, null],
    mum: [null, { startLocal: "22:00", endLocal: "03:30" }, null, null],
    reportFrom: 1,
    reportTo: 2,
  });
  // 22:00 to 03:30 nominal is 5h30m; across the spring change it is 4h30m.
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].elapsedMinutes, 270, "an hour shorter than the clock suggests");
});

test("a gap that is 3 hours on the clock but 2 in reality is allowed across the spring change", () => {
  const result = run({
    days: [
      { date: "2027-03-26", kind: "HOLIDAY" },
      { date: "2027-03-27", kind: "WEEKEND" },
      { date: "2027-03-28", kind: "WEEKEND" },
      { date: "2027-03-29", kind: "HOLIDAY" },
    ],
    dad: [null, null, { startLocal: "00:30", endLocal: "03:30" }, null],
    mum: [null, null, { startLocal: "00:30", endLocal: "03:30" }, null],
    reportFrom: 1,
    reportTo: 2,
  });
  // The shift is on the Sunday the clocks go forward, so 00:30-03:30 on the
  // clock is only two hours actually lived through.
  const sundayGap = result.gaps.find((g) => g.startDate === "2027-03-28");
  assert.ok(sundayGap);
  assert.equal(sundayGap.elapsedMinutes, 120, "three clock hours, two real ones");
  assert.equal(sundayGap.allowed, true);
});

// --- the school-run window itself --------------------------------------

test("schoolRunAdultWindows covers the morning routine and the pick-up, and nothing on a non-school day", () => {
  const windows = schoolRunAdultWindows({
    children: [{ hasSchool: true, attendsToday: true, schoolStartMinutes: SCHOOL_START, schoolEndMinutes: SCHOOL_END }],
    morningFromMinutes: 6 * 60,
    pickupBufferMinutes: 30,
  });
  assert.deepEqual(windows, [
    { startMinutes: 360, endMinutes: SCHOOL_START }, // 06:00 until school starts
    { startMinutes: SCHOOL_END, endMinutes: SCHOOL_END + 30 }, // pick-up
  ]);

  assert.deepEqual(
    schoolRunAdultWindows({
      children: [
        { hasSchool: true, attendsToday: false, schoolStartMinutes: SCHOOL_START, schoolEndMinutes: SCHOOL_END },
      ],
      morningFromMinutes: 6 * 60,
      pickupBufferMinutes: 30,
    }),
    [],
    "no school that day means no school run",
  );
});

test("an overnight gap that ends before the school-run window is still judged by the allowance alone", () => {
  // 01:00-04:00 on a school day: nobody's at home, but it's over well before
  // the morning routine begins, so the school-run rule is not what decides it.
  const result = run({
    days: [
      { date: "2026-09-09", kind: "SCHOOL" },
      { date: "2026-09-10", kind: "SCHOOL" },
      { date: "2026-09-11", kind: "SCHOOL" },
    ],
    dad: [null, { startLocal: "01:00", endLocal: "04:00" }, null],
    mum: [null, { startLocal: "01:00", endLocal: "04:00" }, null],
  });
  assert.equal(result.conflicts.length, 0, "the 13-year-old is home and it is inside the allowance");
  assert.equal(result.byDate["2026-09-10"]?.status, "HANDOVER");
});

test("a household with no children is never judged at all", () => {
  const result = run({
    days: [
      { date: "2026-09-09", kind: "NO_CHILDREN" },
      { date: "2026-09-10", kind: "NO_CHILDREN" },
      { date: "2026-09-11", kind: "NO_CHILDREN" },
    ],
    dad: [null, DAY, null],
    mum: [null, DAY, null],
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.byDate["2026-09-10"], null);
});

test("a day a parent isn't set up on can't be judged, and their absence never invents cover", () => {
  const rule = RULE;
  const days = [
    buildTimelineDay("2026-09-09", childrenFor("SCHOOL"), rule),
    buildTimelineDay("2026-09-10", childrenFor("SCHOOL"), rule),
    buildTimelineDay("2026-09-11", childrenFor("SCHOOL"), rule),
  ];
  const result = evaluateTimeline({
    timeZone: TZ,
    days,
    adults: [
      [
        { known: true, shift: null },
        { known: false, shift: null },
        { known: true, shift: null },
      ],
      [
        { known: true, shift: null },
        { known: true, shift: DAY },
        { known: true, shift: null },
      ],
    ],
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
    reportFrom: 1,
    reportTo: 1,
  });
  assert.equal(result.byDate["2026-09-10"], null, "an unknown parent means no verdict");
  assert.deepEqual(result.conflicts, [], "and no invented conflict either");
});
