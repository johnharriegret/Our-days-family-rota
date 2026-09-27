import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimelineDay,
  minutesOrDefault,
  type ChildDayInfo,
  type HouseholdRuleConfig,
} from "../src/lib/engine/householdDay.ts";

// This is the layer where a bug hid for a whole session: the rules were right,
// the rule tests passed, and the inputs the real app fed them were a different
// shape from the ones the tests fed them. These tests pin the inputs.

const SCHOOL_START = 525; // 08:45
const SCHOOL_END = 915; // 15:15

const RULE: HouseholdRuleConfig = {
  maxUnsupervisedMinutes: 180,
  appliesWeekends: true,
  minSupervisorAge: 13,
  strictPickupAge: 5,
  pickupBufferMinutes: 30,
  schoolRunMorningFromMinutes: 360, // 06:00
};

function child(age: number, attends: boolean, reason: ChildDayInfo["nonSchoolReasonKind"] = null): ChildDayInfo {
  return {
    hasSchool: true,
    attendsToday: attends,
    schoolStartMinutes: SCHOOL_START,
    schoolEndMinutes: SCHOOL_END,
    age,
    nonSchoolReasonKind: reason,
  };
}

test("a school day records the morning routine and the pick-up as needing an adult", () => {
  const day = buildTimelineDay("2026-09-10", [child(13, true), child(3, true)], RULE);
  assert.deepEqual(day.adultOnlyWindows, [
    { startMinutes: 360, endMinutes: SCHOOL_START }, // 06:00 until school starts
    { startMinutes: SCHOOL_END, endMinutes: SCHOOL_END + 30 },
    { startMinutes: 360, endMinutes: SCHOOL_START }, // the second child, same hours
    { startMinutes: SCHOOL_END, endMinutes: SCHOOL_END + 30 },
  ]);
});

test("the supervisor sibling IS recorded as home before school - so only the adult-only window can stop a morning gap", () => {
  // This is the exact input shape the old day-level rule was never tested
  // against. The 13-year-old genuinely is at home before school, so a
  // before-school gap would be excused as ordinary supervision; what makes it a
  // conflict is the adult-only school-run window, not the absence of a sibling.
  const day = buildTimelineDay("2026-09-10", [child(13, true), child(3, true)], RULE);
  const coversEarlyMorning = day.supervisorHome.some(
    (w) => w.startMinutes <= 360 && w.endMinutes >= 480,
  );
  assert.equal(coversEarlyMorning, true, "the sibling is home 06:00-08:00 on a school day");
  const morningNeedsAdult = day.adultOnlyWindows.some(
    (w) => w.startMinutes <= 360 && w.endMinutes >= 480,
  );
  assert.equal(morningNeedsAdult, true, "and that window still needs an adult");
});

test("school only covers the hours EVERY child is there", () => {
  const sameHours = buildTimelineDay("2026-09-10", [child(13, true), child(3, true)], RULE);
  assert.deepEqual(sameHours.schoolCover, { startMinutes: SCHOOL_START, endMinutes: SCHOOL_END });

  // A nursery place that finishes at noon shortens the covered window for the
  // household as a whole, because that child is then at home.
  const nursery: ChildDayInfo = { ...child(3, true), schoolEndMinutes: 720 };
  const mixed = buildTimelineDay("2026-09-10", [child(13, true), nursery], RULE);
  assert.deepEqual(mixed.schoolCover, { startMinutes: SCHOOL_START, endMinutes: 720 });

  // One child at home means school covers nothing.
  const oneHome = buildTimelineDay("2026-09-10", [child(13, true), child(3, false, "NOT_A_TERM_DAY")], RULE);
  assert.equal(oneHome.schoolCover, null);
});

test("a day nobody attends has no school run to do", () => {
  const day = buildTimelineDay("2026-10-27", [child(13, false, "HOLIDAY"), child(3, false, "HOLIDAY")], RULE);
  assert.deepEqual(day.adultOnlyWindows, []);
  assert.equal(day.isSchoolHoliday, true);
  assert.equal(day.schoolCover, null);
});

test("a holiday for only ONE child is not a household school holiday", () => {
  // One child on an INSET day while the other still has school: the school run
  // still has to happen, so the allowance must not be relaxed.
  const day = buildTimelineDay("2026-09-10", [child(13, false, "INSET"), child(3, true)], RULE);
  assert.equal(day.isSchoolHoliday, false);
  assert.ok(day.adultOnlyWindows.length > 0, "the attending child still needs taking");
});

test("a weekend is not a school holiday - the date itself already says so", () => {
  const day = buildTimelineDay("2026-09-12", [child(13, false, "WEEKEND"), child(3, false, "WEEKEND")], RULE);
  assert.equal(day.isSchoolHoliday, false);
});

test("a sibling below the supervisor age is never counted as cover", () => {
  const day = buildTimelineDay("2026-10-27", [child(9, false, "HOLIDAY"), child(3, false, "HOLIDAY")], RULE);
  assert.deepEqual(day.supervisorHome, [], "a 9-year-old cannot supervise");
});

test("turning the sibling allowance off entirely leaves no supervised time", () => {
  const day = buildTimelineDay(
    "2026-10-27",
    [child(16, false, "HOLIDAY")],
    { ...RULE, minSupervisorAge: null },
  );
  assert.deepEqual(day.supervisorHome, []);
});

test("the strict-pickup rule carves the sibling allowance around the young child's own school run", () => {
  const day = buildTimelineDay("2026-09-10", [child(13, true), child(3, true)], RULE);
  // The 3-year-old is below strictPickupAge, so 08:15-08:45 and 15:15-15:45 are
  // removed from what the sibling can cover.
  const covers0815 = day.supervisorHome.some((w) => w.startMinutes <= 495 && w.endMinutes > 495);
  assert.equal(covers0815, false, "the sibling can't do the nursery drop-off");
});

test("a household with no children is marked as having none", () => {
  const day = buildTimelineDay("2026-09-10", [], RULE);
  assert.equal(day.hasChildren, false);
  assert.equal(day.schoolCover, null);
  assert.deepEqual(day.adultOnlyWindows, []);
});

test("minutesOrDefault reads a stored time, and falls back when it's missing or malformed", () => {
  assert.equal(minutesOrDefault("07:30", "06:00"), 450);
  assert.equal(minutesOrDefault(null, "06:00"), 360);
  assert.equal(minutesOrDefault(undefined, "06:00"), 360);
  assert.equal(minutesOrDefault("not a time", "06:00"), 360);
});
