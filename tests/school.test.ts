import { test } from "node:test";
import assert from "node:assert/strict";
import { isSchoolDay } from "../src/lib/engine/school.ts";
import type { SchoolTermSpec } from "../src/lib/engine/types.ts";

const terms: SchoolTermSpec[] = [
  { startDate: "2026-09-01", endDate: "2026-10-23", type: "TERM", label: "Autumn" },
  { startDate: "2026-09-10", endDate: "2026-09-10", type: "INSET", label: "Inset day" },
  { startDate: "2026-10-24", endDate: "2026-11-01", type: "HOLIDAY", label: "Half term" },
];

test("a normal weekday inside term time is a school day", () => {
  assert.equal(isSchoolDay("2026-09-08", terms), true); // Tuesday
});

test("a weekend inside term time is not a school day", () => {
  assert.equal(isSchoolDay("2026-09-06", terms), false); // Sunday
});

test("an INSET day inside term time is not a school day", () => {
  assert.equal(isSchoolDay("2026-09-10", terms), false);
});

test("half term is not a school day even on a weekday", () => {
  assert.equal(isSchoolDay("2026-10-27", terms), false); // Tuesday, half term
});

test("a bank holiday is not a school day even if inside a TERM block", () => {
  assert.equal(isSchoolDay("2026-08-31", [
    { startDate: "2026-08-25", endDate: "2026-10-23", type: "TERM", label: "Autumn" },
  ]), false); // Summer bank holiday Monday
});

test("outside any term block is not a school day", () => {
  assert.equal(isSchoolDay("2026-12-15", terms), false);
});

test("a nursery term restricted to Tue/Wed/Thu excludes Monday and Friday", () => {
  const nursery: SchoolTermSpec[] = [
    { startDate: "2026-09-01", endDate: "2027-01-31", type: "TERM", label: "Nursery", weekdays: [2, 3, 4] },
  ];
  assert.equal(isSchoolDay("2026-09-21", nursery), false); // Monday
  assert.equal(isSchoolDay("2026-09-22", nursery), true); // Tuesday
  assert.equal(isSchoolDay("2026-09-23", nursery), true); // Wednesday
  assert.equal(isSchoolDay("2026-09-24", nursery), true); // Thursday
  assert.equal(isSchoolDay("2026-09-25", nursery), false); // Friday
  assert.equal(isSchoolDay("2027-02-02", nursery), false); // after it ends (late Jan)
});
