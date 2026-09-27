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
};

export type CalendarEventEntry = {
  id: string;
  title: string;
  startLocal: string | null;
  endLocal: string | null;
  category: string;
  memberIds: string[];
};

export type CalendarDayView = {
  date: string;
  members: MemberDayEntry[];
  events: CalendarEventEntry[];
  bothParentsOff: boolean;
};
