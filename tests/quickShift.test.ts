import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShiftKind, resolveQuickShiftConfig } from "../src/lib/quickShift.ts";

test("classifies a normal daytime interval as DAY", () => {
  assert.equal(classifyShiftKind("06:00", "18:00"), "DAY");
});

test("classifies an overnight interval (end <= start) as NIGHT", () => {
  assert.equal(classifyShiftKind("18:00", "06:00"), "NIGHT");
});

test("an interval ending exactly at its start is treated as NIGHT (full 24h overnight)", () => {
  assert.equal(classifyShiftKind("20:00", "20:00"), "NIGHT");
});

test("defaults the 'dad' colour token to orange/blue with no overrides saved", () => {
  const cfg = resolveQuickShiftConfig({ colorToken: "dad" });
  assert.equal(cfg.dayColor, "#E5852B");
  assert.equal(cfg.nightColor, "#3B6FB0");
  assert.equal(cfg.dayStartLocal, "06:00");
  assert.equal(cfg.dayEndLocal, "18:00");
  assert.equal(cfg.nightStartLocal, "18:00");
  assert.equal(cfg.nightEndLocal, "06:00");
});

test("defaults the 'mum' colour token to pink/purple with no overrides saved", () => {
  const cfg = resolveQuickShiftConfig({ colorToken: "mum" });
  assert.equal(cfg.dayColor, "#D9558F");
  assert.equal(cfg.nightColor, "#8659C9");
});

test("an unrecognised colour token still gets a usable fallback, not a crash", () => {
  const cfg = resolveQuickShiftConfig({ colorToken: "child2" });
  assert.equal(typeof cfg.dayColor, "string");
  assert.equal(typeof cfg.nightColor, "string");
});

test("a saved override always wins over the computed default", () => {
  const cfg = resolveQuickShiftConfig({
    colorToken: "dad",
    dayColor: "#123456",
    nightColor: "#654321",
    dayStartLocal: "07:00",
    dayEndLocal: "19:00",
    nightStartLocal: "19:00",
    nightEndLocal: "07:00",
  });
  assert.equal(cfg.dayColor, "#123456");
  assert.equal(cfg.nightColor, "#654321");
  assert.equal(cfg.dayStartLocal, "07:00");
  assert.equal(cfg.nightEndLocal, "07:00");
});
