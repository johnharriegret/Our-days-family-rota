import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePatternDay } from "../src/lib/engine/pattern.ts";
import type { ShiftPatternSpec } from "../src/lib/engine/types.ts";

// 4 day shifts, 4 off, 4 day shifts, 4 off, 4 night shifts, 4 off - the exact
// pattern from the spec: "DDDD OOOO / DDDD OOOO / NNNN OOOO".
const pattern: ShiftPatternSpec = {
  anchor: "2026-09-01",
  blocks: [
    { kind: "D", count: 4, startLocal: "06:00", endLocal: "18:00" },
    { kind: "O", count: 4 },
    { kind: "D", count: 4, startLocal: "06:00", endLocal: "18:00" },
    { kind: "O", count: 4 },
    { kind: "N", count: 4, startLocal: "18:00", endLocal: "06:00" },
    { kind: "O", count: 4 },
  ],
};

test("resolves the anchor date itself as the first block's kind", () => {
  assert.equal(resolvePatternDay("2026-09-01", pattern).kind, "D");
});

test("walks forward through each block boundary correctly", () => {
  assert.equal(resolvePatternDay("2026-09-04", pattern).kind, "D"); // last day of first D block
  assert.equal(resolvePatternDay("2026-09-05", pattern).kind, "O"); // first day of first O block
  assert.equal(resolvePatternDay("2026-09-09", pattern).kind, "D"); // second D block starts
  assert.equal(resolvePatternDay("2026-09-17", pattern).kind, "N"); // night block starts
});

test("repeats the full 24-day cycle", () => {
  const day25 = resolvePatternDay("2026-09-25", pattern);
  const anchorDay = resolvePatternDay(pattern.anchor, pattern);
  assert.equal(day25.kind, anchorDay.kind);
  assert.deepEqual(day25, anchorDay);
});

test("resolves dates before the anchor via wraparound, not just forward dates", () => {
  // One day before the anchor is the last day of the cycle: an O block.
  assert.equal(resolvePatternDay("2026-08-31", pattern).kind, "O");
  // A full cycle before the anchor should match the anchor exactly.
  assert.equal(resolvePatternDay("2026-08-08", pattern).kind, "D");
});

test("night shift block carries its overnight local times", () => {
  const night = resolvePatternDay("2026-09-18", pattern);
  assert.equal(night.kind, "N");
  assert.equal(night.startLocal, "18:00");
  assert.equal(night.endLocal, "06:00");
});
