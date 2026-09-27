// Quick-fill defaults for the Month calendar's paint tool. A parent can paint
// "Day"/"Night" straight onto the calendar without picking a named shift
// type; this resolves what time range and colour that actually means,
// falling back to sensible defaults before anyone has visited Settings to
// customise them. Pure and unit-tested - no DB/UI imports.

export type QuickShiftMember = {
  colorToken: string;
  dayColor?: string | null;
  nightColor?: string | null;
  dayStartLocal?: string | null;
  dayEndLocal?: string | null;
  nightStartLocal?: string | null;
  nightEndLocal?: string | null;
};

export type QuickShiftConfig = {
  dayColor: string;
  nightColor: string;
  dayStartLocal: string;
  dayEndLocal: string;
  nightStartLocal: string;
  nightEndLocal: string;
};

// The two most common colorToken slots (see MEMBER_COLORS) are whoever ran
// /setup ("dad", always the first member) and whoever was added second
// ("mum") - not actually gendered, just palette order - so these are sensible
// defaults for the two-parent case, not a hardcoded assumption about names.
const TOKEN_DEFAULTS: Record<string, { day: string; night: string }> = {
  dad: { day: "#E5852B", night: "#3B6FB0" }, // orange / blue
  mum: { day: "#D9558F", night: "#8659C9" }, // pink / purple
};

const FALLBACK_DAY = "#6a63d1";
const FALLBACK_NIGHT = "#2f2a5e";

/** Resolves the actual colours/times to use, merging saved overrides with defaults. */
export function resolveQuickShiftConfig(member: QuickShiftMember): QuickShiftConfig {
  const tokenDefault = TOKEN_DEFAULTS[member.colorToken];
  return {
    dayColor: member.dayColor || tokenDefault?.day || FALLBACK_DAY,
    nightColor: member.nightColor || tokenDefault?.night || FALLBACK_NIGHT,
    dayStartLocal: member.dayStartLocal || "06:00",
    dayEndLocal: member.dayEndLocal || "18:00",
    nightStartLocal: member.nightStartLocal || "18:00",
    nightEndLocal: member.nightEndLocal || "06:00",
  };
}

export type ShiftDisplayKind = "DAY" | "NIGHT";

/**
 * Classifies a resolved shift interval as a day or night shift purely from its
 * times - consistent with the overnight-shift convention already used by
 * src/lib/engine/intervals.ts and coverage.ts ("end <= start means overnight").
 * Works for both repeating-pattern shifts and named/custom manual shifts
 * without needing a separate "kind" field on ShiftType.
 */
export function classifyShiftKind(startLocal: string, endLocal: string): ShiftDisplayKind {
  return endLocal <= startLocal ? "NIGHT" : "DAY";
}
