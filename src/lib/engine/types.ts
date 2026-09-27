// All dates are "YYYY-MM-DD" calendar-date strings (no time component) unless noted.
// All times-of-day are "HH:MM" 24-hour local wall-clock strings.
// All durations/positions-in-day are minutes, never fractional hours, to avoid float drift.

export type ShiftBlockSpec = {
  kind: string; // 'D' | 'N' | 'O' | any custom code
  count: number; // consecutive days this block covers
  startLocal?: string | null; // null/omitted for an OFF block
  endLocal?: string | null;
};

export type ShiftPatternSpec = {
  anchor: string; // the date the block sequence is defined to start from
  blocks: ShiftBlockSpec[];
};

export type ResolvedShift = {
  kind: string;
  startLocal: string | null;
  endLocal: string | null;
};

export type UtcInterval = {
  start: Date;
  end: Date;
};

export type PaidShiftRecord = {
  date: string;
  paidMinutes: number;
};

export type SchoolTermSpec = {
  startDate: string;
  endDate: string;
  type: "TERM" | "HOLIDAY" | "INSET" | "BANK_HOLIDAY";
  label: string;
  /** weekdays this block applies to, 0=Sun..6=Sat; defaults to Mon-Fri. */
  weekdays?: number[];
};

export type ChildcareRuleSpec = {
  maxUnsupervisedMinutes: number;
  appliesWeekends: boolean;
  minSupervisorAge: number | null;
};

/** A covered-or-gap window within a single calendar day, in minutes from local midnight (0-1440). */
export type DayInterval = {
  startMinutes: number;
  endMinutes: number;
};

export type ChildcareStatus = "SAFE" | "HANDOVER" | "CHILDCARE_NEEDED";

export type ChildcareResult = {
  status: ChildcareStatus;
  uncoveredMinutes: number;
  gapStart: string | null;
  gapEnd: string | null;
  explanation: string;
};
