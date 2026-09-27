import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchoolCalendarText, validateVisionBlocks } from "../src/lib/schoolImport.ts";

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

// --- validateVisionBlocks: the untrusted-AI-output boundary ----------------

test("passes through a well-formed, self-consistent block as high confidence", () => {
  const { blocks, warnings } = validateVisionBlocks({
    blocks: [{ label: "Autumn 1", type: "TERM", startDate: "2026-09-07", endDate: "2026-10-23", confidence: "high" }],
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].confidence, "high");
  assert.deepEqual(blocks[0].weekdays, [1, 2, 3, 4, 5]);
  assert.equal(warnings.length, 0);
});

test("downgrades to review when a date is missing, even if the model claimed high confidence", () => {
  const { blocks, warnings } = validateVisionBlocks({
    blocks: [{ label: "Summer 2", type: "TERM", startDate: "2027-06-10", endDate: null, confidence: "high" }],
  });
  assert.equal(blocks[0].confidence, "review");
  assert.equal(blocks[0].startDate, "2027-06-10");
  assert.equal(blocks[0].endDate, null);
  assert.ok(warnings.some((w) => w.includes("Summer 2")));
});

test("downgrades to review when start is after end, regardless of claimed confidence", () => {
  const { blocks } = validateVisionBlocks({
    blocks: [{ label: "Bad range", type: "TERM", startDate: "2026-10-23", endDate: "2026-09-07", confidence: "high" }],
  });
  assert.equal(blocks[0].confidence, "review");
});

test("never invents a date - an unparseable date string becomes null, not a guess", () => {
  const { blocks } = validateVisionBlocks({
    blocks: [{ label: "Smudged", type: "HOLIDAY", startDate: "sometime in October", endDate: "2026-10-30", confidence: "high" }],
  });
  assert.equal(blocks[0].startDate, null);
  assert.equal(blocks[0].confidence, "review");
});

test("rejects an unknown type and falls back to TERM rather than trusting arbitrary AI text", () => {
  const { blocks } = validateVisionBlocks({
    blocks: [{ label: "Weird", type: "DROP TABLE schools;--", startDate: "2026-09-01", endDate: "2026-09-02", confidence: "high" }],
  });
  assert.equal(blocks[0].type, "TERM");
});

test("clamps out-of-range weekday values instead of trusting them", () => {
  const { blocks } = validateVisionBlocks({
    blocks: [{ label: "Nursery", type: "TERM", startDate: "2026-09-01", endDate: "2027-01-31", weekdays: [2, 3, 4, 99, -1], confidence: "high" }],
  });
  assert.deepEqual(blocks[0].weekdays, [2, 3, 4]);
});

test("handles a completely malformed or empty response without throwing", () => {
  assert.deepEqual(validateVisionBlocks(null).blocks, []);
  assert.deepEqual(validateVisionBlocks({}).blocks, []);
  assert.deepEqual(validateVisionBlocks({ blocks: "not an array" }).blocks, []);
  assert.deepEqual(validateVisionBlocks({ blocks: [null, 42, "x"] }).blocks, []);
  assert.ok(validateVisionBlocks(null).warnings.length > 0);
});
