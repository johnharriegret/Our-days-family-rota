import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOffTogether, nextDayOffTogether } from "../src/lib/engine/daysOffTogether.ts";

const bothOffDates = new Set(["2026-09-05", "2026-09-06", "2026-09-13"]);
const isBothOff = (date: string) => bothOffDates.has(date);

test("lists every date in range where both are off", () => {
  const result = daysOffTogether("2026-09-01", "2026-09-10", isBothOff);
  assert.deepEqual(result, ["2026-09-05", "2026-09-06"]);
});

test("finds the next shared day off from an arbitrary starting date", () => {
  assert.equal(nextDayOffTogether("2026-09-01", isBothOff), "2026-09-05");
  assert.equal(nextDayOffTogether("2026-09-06", isBothOff), "2026-09-06");
  assert.equal(nextDayOffTogether("2026-09-07", isBothOff), "2026-09-13");
});

test("returns null when nothing is found within the lookahead window", () => {
  assert.equal(nextDayOffTogether("2026-09-14", isBothOff, 10), null);
});
