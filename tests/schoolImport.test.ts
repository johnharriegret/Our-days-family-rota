import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchoolCalendarText } from "../src/lib/schoolImport.ts";

test("pairs 'school opens' / 'break up' lines into term blocks (Format A)", () => {
  const text = `
    School opens - Monday 7 September 2026
    Break up - Friday 23 October 2026
    School opens - Monday 2 November 2026
    Break up - Friday 18 December 2026
    INSET Day - Monday 7 June 2027
  `;
  const { blocks } = parseSchoolCalendarText(text);
  const terms = blocks.filter((b) => b.type === "TERM");
  assert.equal(terms.length, 2);
  assert.deepEqual(terms[0], { label: "School opens", type: "TERM", startDate: "2026-09-07", endDate: "2026-10-23", confidence: "high" });
  assert.equal(terms[1].startDate, "2026-11-02");
  const inset = blocks.find((b) => b.type === "INSET");
  assert.equal(inset?.startDate, "2027-06-07");
  assert.equal(inset?.endDate, "2027-06-07");
});

test("reads an explicit single-line range", () => {
  const { blocks } = parseSchoolCalendarText("Autumn term: 2 September 2026 to 24 October 2026");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "TERM");
  assert.equal(blocks[0].startDate, "2026-09-02");
  assert.equal(blocks[0].endDate, "2026-10-24");
});

test("classifies half term and holidays as HOLIDAY", () => {
  const { blocks } = parseSchoolCalendarText("Half term: 26 October 2026 - 30 October 2026");
  assert.equal(blocks[0].type, "HOLIDAY");
  assert.equal(blocks[0].startDate, "2026-10-26");
});

test("handles numeric and ISO dates", () => {
  const { blocks } = parseSchoolCalendarText("Spring term 04/01/2027 - 2027-02-12");
  assert.equal(blocks[0].startDate, "2027-01-04");
  assert.equal(blocks[0].endDate, "2027-02-12");
});

test("infers the year from the academic year when the sheet omits it", () => {
  const { blocks } = parseSchoolCalendarText("Autumn term: 2 September to 18 December", { academicYearStart: 2026 });
  assert.equal(blocks[0].startDate, "2026-09-02");
  assert.equal(blocks[0].endDate, "2026-12-18");
  const spring = parseSchoolCalendarText("Spring term: 5 January to 12 February", { academicYearStart: 2026 });
  assert.equal(spring.blocks[0].startDate, "2027-01-05"); // Jan rolls into the next calendar year
});

test("does not invent dates it cannot read", () => {
  const { blocks, unrecognised } = parseSchoolCalendarText("Term starts sometime in September\nRandom note");
  assert.equal(blocks.length, 0);
  assert.ok(unrecognised.length >= 1);
});
