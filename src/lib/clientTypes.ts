export type MemberKind = "PARENT" | "CHILD";

export type FamilyMember = {
  id: string;
  name: string;
  kind: MemberKind;
  colorToken: string;
  icon: string;
  dateOfBirth: string | null;
  schoolId: string | null;
  requiredWeeklyMinutes: number | null;
  dayColor?: string | null;
  nightColor?: string | null;
  dayStartLocal?: string | null;
  dayEndLocal?: string | null;
  nightStartLocal?: string | null;
  nightEndLocal?: string | null;
  /** Their own sign-in, if one's been set up for them - null until then. */
  login?: { id: string; email: string } | null;
};

export type ShiftType = {
  id: string;
  ownerId: string;
  name: string;
  startLocal: string;
  endLocal: string;
  paidMinutes: number;
  color: string;
};

export type MemberDayEntry = {
  memberId: string;
  shiftId: string | null;
  name: string;
  colorToken: string;
  icon: string;
  memberKind: MemberKind;
  label: string;
  startLocal: string | null;
  endLocal: string | null;
  isOff: boolean;
  locked: boolean;
  source: "PATTERN" | "MANUAL" | "SCHOOL" | "NONE";
  displayColor: string | null;
};

export type CalendarEventEntry = {
  id: string;
  title: string;
  startLocal: string | null;
  endLocal: string | null;
  category: string;
  memberIds: string[];
};

export type CalendarChildcare = {
  status: "SAFE" | "HANDOVER" | "CHILDCARE_NEEDED";
  explanation: string;
  gapStart: string | null;
  gapEnd: string | null;
};

export type CalendarDayView = {
  date: string;
  members: MemberDayEntry[];
  events: CalendarEventEntry[];
  bothParentsOff: boolean;
  childcare: CalendarChildcare | null;
};
