import { isSchoolDay, nonSchoolDayReason } from "./engine";
import type { ChildDayInfo } from "./engine";
import type { ShiftPatternSpec } from "./engine/types";

export type PatternVersion = { effectiveFrom: string; spec: ShiftPatternSpec };

export function activePattern(versionsByOwner: Map<string, PatternVersion[]>, ownerId: string, date: string): ShiftPatternSpec | null {
  const versions = versionsByOwner.get(ownerId);
  if (!versions) return null;
  let active: ShiftPatternSpec | null = null;
  for (const version of versions) {
    if (version.effectiveFrom <= date) active = version.spec;
    else break;
  }
  return active;
}

export function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function ageOn(date: string, dob: string | null): number | null {
  if (!dob) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [birthYear, birthMonth, birthDay] = dob.slice(0, 10).split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

type SchoolTermInput = { startDate: Date; endDate: Date; type: "TERM" | "HOLIDAY" | "INSET" | "BANK_HOLIDAY"; label: string; weekdays: number[] };
export type ChildForHouseholdContext = { dateOfBirth: Date | null; school: { startLocal: string; endLocal: string; terms: SchoolTermInput[] } | null };
const toDateStr = (date: Date) => date.toISOString().slice(0, 10);

/** Build the engine's child facts identically for calendar and planner paths. */
export function childInfoFor(children: ChildForHouseholdContext[], date: string): ChildDayInfo[] {
  return children.map((child) => {
    const terms = child.school?.terms.map((term) => ({ startDate: toDateStr(term.startDate), endDate: toDateStr(term.endDate), type: term.type, label: term.label, weekdays: term.weekdays })) ?? [];
    const attendsToday = child.school ? isSchoolDay(date, terms) : false;
    const reason = child.school && !attendsToday ? nonSchoolDayReason(date, terms) : null;
    return {
      hasSchool: Boolean(child.school),
      attendsToday,
      schoolStartMinutes: child.school ? toMinutes(child.school.startLocal) : 0,
      schoolEndMinutes: child.school ? toMinutes(child.school.endLocal) : 0,
      age: ageOn(date, child.dateOfBirth ? toDateStr(child.dateOfBirth) : null),
      nonSchoolReasonKind: reason?.kind ?? null,
    };
  });
}
