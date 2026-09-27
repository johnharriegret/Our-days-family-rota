import { dayDiff } from "./dates";
import type { ResolvedShift, ShiftPatternSpec } from "./types";

export function cycleLength(pattern: ShiftPatternSpec): number {
  return pattern.blocks.reduce((sum, block) => sum + block.count, 0);
}

const OFF: ResolvedShift = { kind: "O", startLocal: null, endLocal: null };

/**
 * Resolves what a repeating shift pattern says for a given calendar date.
 * Works for dates before the anchor too (negative modulo wraps forward),
 * so one pattern row answers "what was/will this person be doing" for any date.
 */
export function resolvePatternDay(
  date: string,
  pattern: ShiftPatternSpec,
): ResolvedShift {
  const total = cycleLength(pattern);
  if (total <= 0) return OFF;

  let offset = dayDiff(date, pattern.anchor) % total;
  if (offset < 0) offset += total;

  let cursor = 0;
  for (const block of pattern.blocks) {
    if (offset < cursor + block.count) {
      return {
        kind: block.kind,
        startLocal: block.startLocal ?? null,
        endLocal: block.endLocal ?? null,
      };
    }
    cursor += block.count;
  }
  return OFF;
}
