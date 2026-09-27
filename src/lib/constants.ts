// Small shared vocabulary used across API routes and UI - kept in one place so
// "what colours/icons can a family member have" isn't duplicated everywhere.

export const MEMBER_COLORS = [
  { token: "dad", hex: "#4A6FA5" },
  { token: "mum", hex: "#B5548A" },
  { token: "child1", hex: "#3FA872" },
  { token: "child2", hex: "#E2A33E" },
  { token: "child3", hex: "#8B6FD6" },
  { token: "family", hex: "#D6614A" },
] as const;

export const MEMBER_ICONS = ["dad", "mum", "child", "family"] as const;

export const DEFAULT_CHILDCARE_RULE = {
  maxUnsupervisedMinutes: 180,
  appliesWeekends: true,
  minSupervisorAge: 13,
};

/** Highlight colour for a day both parents are off, until customised in Settings. */
export const DEFAULT_TOGETHER_COLOR = "#f2c94c";
