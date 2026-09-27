import { test } from "node:test";
import assert from "node:assert/strict";
import { planMumWeek } from "../src/lib/engine/mumOptimiser.ts";
import type { MumShiftOption, OptimiserDay, OptimiserResult } from "../src/lib/engine/mumOptimiser.ts";
import { buildTimelineDay, type ChildDayInfo, type HouseholdRuleConfig } from "../src/lib/engine/householdDay.ts";
import { addDays, isWeekend } from "../src/lib/engine/dates.ts";

/**
 * Optimiser BACKBONE regression suite.
 *
 * The continuous-timeline rebuild made childcare a hard pre-ranking filter and
 * put every day (Dad's OFF days included) in the candidate search. These tests
 * pin the search-architecture guarantees the rest of the suite doesn't:
 *
 *   - Dad's OFF days are genuinely usable, so the false "no safe plan" that
 *     preserved shared weekends at the cost of unsafe weekday overlaps can't
 *     come back (brief §5, §12.A).
 *   - "No safe plan" is only ever claimed when the search was EXHAUSTIVE, and a
 *     truncated search says so instead of asserting a fact it never proved
 *     (brief §10). This is what the new diagnostics make checkable.
 *   - A real, multi-child, multi-week household - Dad's 4-on/4-off with a
 *     day→night transition, term rolling into half term, a week boundary -
 *     behaves sensibly across the whole cycle (brief §12.H), not just on a toy
 *     one-shift week.
 *
 * The validator itself (day+night asymmetry, weekend/holiday allowance to the
 * minute, DST, Sunday-night→Monday) is proved in tests/timeline.test.ts; this
 * file is about the search on top of it.
 */

const TZ = "Europe/London";

// The real household's shape: a 13-year-old (can supervise) and a 3-year-old.
const SCHOOL_START = 525; // 08:45
const SCHOOL_END = 915; // 15:15

const LONG_DAY: MumShiftOption = { id: "long", name: "Long Day", startLocal: "07:00", endLocal: "20:00", paidMinutes: 750 };
const SCHOOL_HOURS: MumShiftOption = { id: "nine4", name: "9-4", startLocal: "09:00", endLocal: "15:00", paidMinutes: 360 };

const DAD_DAY = { startLocal: "06:00", endLocal: "18:00" };
const DAD_NIGHT = { startLocal: "18:00", endLocal: "06:00" };

const RULE: HouseholdRuleConfig = {
  maxUnsupervisedMinutes: 180,
  appliesWeekends: true,
  minSupervisorAge: 13,
  strictPickupAge: null,
  pickupBufferMinutes: 30,
  schoolRunMorningFromMinutes: 360, // 06:00
};

/** Two children who attend school on weekday term days. */
function termChildren(date: string): ChildDayInfo[] {
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

/** The same children during a recognised school holiday (no school run to make). */
function holidayChildren(date: string): ChildDayInfo[] {
  return [13, 3].map((age) => ({
    hasSchool: true,
    attendsToday: false,
    schoolStartMinutes: SCHOOL_START,
    schoolEndMinutes: SCHOOL_END,
    age,
    nonSchoolReasonKind: isWeekend(date) ? ("WEEKEND" as const) : ("HOLIDAY" as const),
  }));
}

type DadStatus = "DAY" | "NIGHT" | "OFF";
const dadShiftFor = (s: DadStatus) => (s === "DAY" ? DAD_DAY : s === "NIGHT" ? DAD_NIGHT : null);

function buildDay(
  date: string,
  dad: DadStatus,
  children: (d: string) => ChildDayInfo[],
  over: Partial<OptimiserDay> = {},
): OptimiserDay {
  return {
    ...buildTimelineDay(date, children(date), RULE),
    hasChildren: true,
    dadKnown: true,
    dadShift: dadShiftFor(dad),
    ownKnown: true,
    ownShift: null,
    locked: null,
    ...over,
  };
}

/**
 * Plans one Monday-start week over a full window (a context day either side),
 * driving Dad's status per weekday and the children per date. Mirrors how
 * optimiserService builds its window, so these are the real inputs, not a
 * hand-fed shape.
 */
function planWeek(opts: {
  weekStart: string;
  dad: DadStatus[]; // seven entries, Mon..Sun
  dadBefore?: DadStatus;
  dadAfter?: DadStatus;
  children?: (d: string) => ChildDayInfo[];
  requiredMinutes: number;
  shiftOptions: MumShiftOption[];
  priorOwnShift?: { startLocal: string; endLocal: string } | null;
  maxCandidates?: number;
}): OptimiserResult {
  const children = opts.children ?? termChildren;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(opts.weekStart, i));
  const before = buildDay(addDays(opts.weekStart, -1), opts.dadBefore ?? "OFF", children, {
    ...(opts.priorOwnShift !== undefined ? { ownShift: opts.priorOwnShift } : {}),
  });
  const week = dates.map((d, i) => buildDay(d, opts.dad[i], children));
  const after = buildDay(addDays(opts.weekStart, 7), opts.dadAfter ?? "OFF", children);
  return planMumWeek({
    timeZone: TZ,
    days: [before, ...week, after],
    reportFrom: 1,
    reportTo: 7,
    requiredMinutes: opts.requiredMinutes,
    shiftOptions: opts.shiftOptions,
    rule: { maxUnsupervisedMinutes: RULE.maxUnsupervisedMinutes, appliesWeekends: RULE.appliesWeekends },
    maxCandidates: opts.maxCandidates,
  });
}

// --- Case A: Dad's OFF days are usable (the 5-11 Oct shape, generally) ----

test("A. Dad's OFF days are used for Mum's work; his DAY days are never overlapped, and Fri/Sat/Sun aren't preserved at the cost of safety", () => {
  // The exact production shape from the brief. Nothing in the engine special-
  // cases these dates - 5 Oct 2026 is simply a Monday - so a pass here is a
  // pass for the general rule, not a patch for one week.
  //   Dad: Mon OFF, Tue/Wed/Thu DAY, Fri/Sat/Sun OFF.
  // Mum must work 2x Long Day (07:00-20:00). On Dad's DAY days (Tue-Thu) both
  // parents would be out across the school run: unsafe. The only safe homes for
  // a Long Day are the days Dad is off - Mon, Fri, Sat, Sun.
  const res = planWeek({
    weekStart: "2026-10-05",
    dad: ["OFF", "DAY", "DAY", "DAY", "OFF", "OFF", "OFF"],
    requiredMinutes: 1500,
    shiftOptions: [LONG_DAY],
  });

  assert.ok(res.best, "a safe plan exists and must be found, not reported as impossible");
  assert.equal(res.best.metrics.childcareConflicts, 0);
  assert.equal(res.best.metrics.totalPaidMinutes, 1500, "hits the contracted hours exactly");

  const workedDayIndexes = res.best.days.flatMap((d, i) => (d.option ? [i] : []));
  assert.equal(workedDayIndexes.length, 2, "two Long Days, no more");
  const dadOffDays = new Set([0, 4, 5, 6]); // Mon, Fri, Sat, Sun
  for (const i of workedDayIndexes) {
    assert.ok(dadOffDays.has(i), `Mum works only on a day Dad is off (day index ${i})`);
  }
  // Tue/Wed/Thu (Dad on days) are never chosen - the unsafe-overlap trap.
  for (const i of [1, 2, 3]) {
    assert.equal(res.best.days[i].option, null, `no Mum shift on Dad's DAY day (index ${i})`);
  }
  // And the search really did explore and keep those off-day candidates.
  assert.ok(res.diagnostics.exhaustive, "the search was exhaustive");
  assert.ok(res.diagnostics.safe > 0, "at least one safe candidate was found");
});

// --- Case B: safety beats couple time --------------------------------------

test("B. a safe plan with fewer shared days off beats an unsafe plan with more", () => {
  // Dad on DAY all week (school days). A Long Day overlaps the school run and is
  // unsafe on every day; two 9-4s miss the hours slightly but stay safe. The
  // safe, less-convenient plan must win - no amount of shared time off can
  // promote the unsafe one, because unsafe candidates are removed before ranking.
  const res = planWeek({
    weekStart: "2026-10-05",
    dad: ["DAY", "DAY", "DAY", "DAY", "DAY", "DAY", "DAY"],
    dadBefore: "DAY",
    dadAfter: "DAY",
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY, SCHOOL_HOURS],
  });
  assert.ok(res.best, "the safe (weekend) plan is found");
  assert.equal(res.best.metrics.childcareConflicts, 0, "never offers a plan with a gap as best");
  // The only safe homes are the weekend (allowance applies, Dad's absence aside):
  // two 9-4s on Sat/Sun, not a Long Day on a school day.
  assert.ok(
    res.best.days.every((d) => !d.option || d.option.id === "nine4"),
    "chooses the safe school-hours shifts, not the unsafe Long Day",
  );
});

// --- Case G + diagnostics: "no safe plan" is PROVABLE, never a guess --------

/**
 * A genuinely impossible week. With no locked days, "Mum works nothing" is
 * always a safe escape (she stays home and covers), so the only way to force a
 * true no-safe-plan is a locked working day that itself conflicts - here a
 * Wednesday Long Day the optimiser isn't allowed to move, while Dad works a day
 * shift and the children are at school, so the school run is uncovered no matter
 * what happens on the other six days.
 */
function impossibleWindow(maxCandidates?: number): OptimiserResult {
  const lockedWed = (date: string) =>
    buildDay(date, "DAY", termChildren, {
      locked: { paidMinutes: 750, shift: { startLocal: "07:00", endLocal: "20:00" }, label: "Long Day" },
    });
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays("2026-10-05", i);
    return i === 2 ? lockedWed(date) : buildDay(date, "DAY", termChildren);
  });
  return planMumWeek({
    timeZone: TZ,
    days: [buildDay("2026-10-04", "DAY", termChildren), ...week, buildDay("2026-10-12", "DAY", termChildren)],
    reportFrom: 1,
    reportTo: 7,
    requiredMinutes: 750,
    shiftOptions: [LONG_DAY, SCHOOL_HOURS], // several combos land in-band, so a cap can truncate
    rule: { maxUnsupervisedMinutes: 180, appliesWeekends: true },
    maxCandidates,
  });
}

test("G. a genuinely impossible week reports no safe plan AND proves it was exhaustive", () => {
  const impossible = impossibleWindow();

  assert.equal(impossible.best, null, "no unsafe plan is ever presented as selectable");
  assert.ok(impossible.bestWithConflicts, "the closest option is kept only to explain why");
  assert.ok(impossible.bestWithConflicts.conflicts.length > 0);
  assert.match(impossible.message ?? "", /no safe plan/i);
  // The proof: the search was exhaustive, so "no safe plan" is a fact.
  assert.equal(impossible.diagnostics.exhaustive, true);
  assert.equal(impossible.diagnostics.truncated, false);
  assert.ok(impossible.diagnostics.generated > 0, "candidates were generated");
  assert.equal(impossible.diagnostics.safe, 0, "and none was safe");
  assert.equal(
    impossible.diagnostics.rejectedByChildcare,
    impossible.diagnostics.generated,
    "every generated candidate was culled by childcare, all accounted for",
  );
});

// --- Truncation honesty: a capped search must not claim exhaustiveness ------

test("truncation: a search that hits its cap never claims 'every option' / 'no safe plan'", () => {
  // The same impossible week, but forced to stop after one candidate. The
  // optimiser must NOT assert that no safe plan exists - it never finished
  // looking, and saying "every option leaves a gap" would be a fabricated fact.
  const res = impossibleWindow(1);

  assert.equal(res.best, null, "still offers no unsafe plan as best");
  assert.equal(res.diagnostics.truncated, true, "the search was truncated");
  assert.equal(res.diagnostics.exhaustive, false, "and therefore not exhaustive");
  assert.doesNotMatch(
    res.message ?? "",
    /every option leaves a childcare gap/i,
    "must not claim every option was checked when it wasn't",
  );
  assert.match(res.message ?? "", /(does not prove|not proof|size limit)/i, "says the search was incomplete");
});

test("a normal, solvable week reports an exhaustive search", () => {
  const res = planWeek({
    weekStart: "2026-10-05",
    dad: ["OFF", "DAY", "DAY", "DAY", "OFF", "OFF", "OFF"],
    requiredMinutes: 1500,
    shiftOptions: [LONG_DAY],
  });
  assert.ok(res.best);
  assert.equal(res.diagnostics.exhaustive, true);
  assert.equal(res.diagnostics.truncated, false);
  assert.equal(res.diagnostics.bestSignature !== null, true, "the winning candidate is identified");
});

// --- Case H: the real household across a multi-week cycle -------------------

test("H. real household full cycle: Dad 4-on/4-off day→night transition, term into half term, week boundary", () => {
  // Two consecutive weeks, planned the way getMumMonthPlan does it: the first
  // week's suggested Sunday is chained into the second week's 'day before'.
  //   Week A (term):     Dad Mon/Tue DAY, Wed/Thu NIGHT, Fri/Sat/Sun OFF.
  //   Week B (half term): Dad Mon OFF, Tue/Wed DAY, Thu/Fri NIGHT, Sat/Sun OFF.
  // Dad DAY + Mum out = unsafe on a school day (case C); Dad NIGHT means Dad is
  // HOME through the daytime school run (case D), so a daytime Mum shift there
  // is safe; his OFF days are always safe. Mum needs 2x 9-4 (720) each week.

  const weekA = planWeek({
    weekStart: "2026-10-19",
    dad: ["DAY", "DAY", "NIGHT", "NIGHT", "OFF", "OFF", "OFF"],
    dadBefore: "OFF",
    dadAfter: "OFF", // Sun 25 -> Mon 26 Dad off
    children: termChildren,
    requiredMinutes: 720,
    shiftOptions: [SCHOOL_HOURS],
  });

  assert.ok(weekA.best, "week A has a safe plan");
  assert.equal(weekA.best.metrics.childcareConflicts, 0);
  assert.equal(weekA.best.metrics.totalPaidMinutes, 720, "hits the weekly hours exactly");
  assert.ok(weekA.diagnostics.exhaustive, "week A search exhaustive");
  // Case C respected inside a realistic week: never scheduled when Dad works a
  // DAY shift on a school day (Mon=0, Tue=1).
  assert.equal(weekA.best.days[0].option, null, "no Mum shift while Dad works Monday DAY");
  assert.equal(weekA.best.days[1].option, null, "no Mum shift while Dad works Tuesday DAY");

  // Chain week A's proposed Sunday into week B, exactly as getMumMonthPlan does.
  const sunday = weekA.best.days[6];
  const priorOwnShift = sunday.option
    ? { startLocal: sunday.option.startLocal, endLocal: sunday.option.endLocal }
    : null;

  const weekB = planWeek({
    weekStart: "2026-10-26",
    dad: ["OFF", "DAY", "DAY", "NIGHT", "NIGHT", "OFF", "OFF"],
    dadBefore: "OFF", // Sun 25 (Dad off); Mum's proposed Sunday chained below
    dadAfter: "OFF",
    children: holidayChildren, // half term: allowance applies, no school run
    requiredMinutes: 720,
    shiftOptions: [SCHOOL_HOURS],
    priorOwnShift,
  });

  assert.ok(weekB.best, "week B (half term) has a safe plan");
  assert.equal(weekB.best.metrics.childcareConflicts, 0);
  assert.equal(weekB.best.metrics.totalPaidMinutes, 720);
  assert.ok(weekB.diagnostics.exhaustive, "week B search exhaustive");

  // Across the whole cycle, no week ever presented an unsafe plan as best, and
  // no week made an unprovable "no safe plan" claim.
  for (const wk of [weekA, weekB]) {
    assert.equal(wk.best?.metrics.childcareConflicts ?? 0, 0);
    assert.equal(wk.diagnostics.truncated, false);
  }
});
