import { prisma } from "./prisma";
import { addDays, isSchoolDay, resolvePatternDay } from "./engine";
import type { ShiftPatternSpec } from "./engine/types";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type MemberDayEntry = {
  memberId: string;
  name: string;
  colorToken: string;
  icon: string;
  memberKind: "PARENT" | "CHILD";
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

/**
 * Builds a day-by-day view for [from, to] (inclusive), merging each parent's
 * repeating pattern with any manual override/entry for that date, and each
 * child's school-day status. This is Phase 1 scope: it does not yet compute
 * childcare-conflict status (that's Phase 2's job, built on top of the
 * already-tested lib/engine/childcare.ts).
 */
export async function getCalendarRange(
  householdId: string,
  from: string,
  to: string,
): Promise<CalendarDayView[]> {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);

  const members = await prisma.familyMember.findMany({
    where: { householdId, archived: false },
    include: { school: { include: { terms: true } } },
    orderBy: { kind: "asc" },
  });
  const parentIds = members.filter((m) => m.kind === "PARENT").map((m) => m.id);

  // Load every version (including archived ones) so a rota correction made
  // today doesn't retroactively rewrite what the calendar showed for past
  // dates: each version only applies from its own effectiveFrom onward.
  const patterns = await prisma.shiftPattern.findMany({
    where: { householdId, ownerId: { in: parentIds } },
    include: { blocks: { orderBy: { order: "asc" } } },
    orderBy: { effectiveFrom: "asc" },
  });
  const patternVersionsByOwner = new Map<
    string,
    { effectiveFrom: string; spec: ShiftPatternSpec }[]
  >();
  for (const p of patterns) {
    const list = patternVersionsByOwner.get(p.ownerId) ?? [];
    list.push({
      effectiveFrom: toDateStr(p.effectiveFrom),
      spec: {
        anchor: toDateStr(p.anchor),
        blocks: p.blocks.map((b) => ({
          kind: b.kind,
          count: b.count,
          startLocal: b.startLocal,
          endLocal: b.endLocal,
        })),
      },
    });
    patternVersionsByOwner.set(p.ownerId, list);
  }

  function activePatternFor(ownerId: string, date: string): ShiftPatternSpec | null {
    const versions = patternVersionsByOwner.get(ownerId);
    if (!versions) return null;
    let active: ShiftPatternSpec | null = null;
    for (const v of versions) {
      if (v.effectiveFrom <= date) active = v.spec;
      else break;
    }
    return active;
  }

  const shiftTypes = await prisma.shiftType.findMany({ where: { householdId } });
  const shiftTypeById = new Map(shiftTypes.map((t) => [t.id, t]));

  const workShifts = await prisma.workShift.findMany({
    where: { householdId, date: { gte: fromDate, lte: toDate } },
  });
  const workShiftByKey = new Map(workShifts.map((s) => [`${s.ownerId}|${toDateStr(s.date)}`, s]));

  const events = await prisma.event.findMany({
    where: { householdId, date: { gte: fromDate, lte: toDate } },
  });
  const eventsByDate = new Map<string, CalendarEventEntry[]>();
  for (const e of events) {
    const key = toDateStr(e.date);
    const list = eventsByDate.get(key) ?? [];
    list.push({
      id: e.id,
      title: e.title,
      startLocal: e.startLocal,
      endLocal: e.endLocal,
      category: e.category,
      memberIds: e.memberIds,
    });
    eventsByDate.set(key, list);
  }

  const days: CalendarDayView[] = [];
  let cursor = from;
  while (cursor <= to) {
    const date = cursor;
    const memberEntries: MemberDayEntry[] = members.map((member) => {
      if (member.kind === "CHILD") {
        const terms =
          member.school?.terms.map((t) => ({
            startDate: toDateStr(t.startDate),
            endDate: toDateStr(t.endDate),
            type: t.type,
            label: t.label,
          })) ?? [];
        const atSchool = member.school ? isSchoolDay(date, terms) : false;
        return {
          memberId: member.id,
          name: member.name,
          colorToken: member.colorToken,
          icon: member.icon,
          memberKind: "CHILD",
          label: atSchool ? `School ${member.school!.startLocal}–${member.school!.endLocal}` : "Home",
          startLocal: atSchool ? member.school!.startLocal : null,
          endLocal: atSchool ? member.school!.endLocal : null,
          isOff: !atSchool,
          locked: false,
          source: "SCHOOL",
        };
      }

      const manual = workShiftByKey.get(`${member.id}|${date}`);
      if (manual) {
        const type = manual.shiftTypeId ? shiftTypeById.get(manual.shiftTypeId) : null;
        const startLocal = type?.startLocal ?? manual.customStart ?? null;
        const endLocal = type?.endLocal ?? manual.customEnd ?? null;
        const isWorking = Boolean(startLocal && endLocal);
        return {
          memberId: member.id,
          name: member.name,
          colorToken: member.colorToken,
          icon: member.icon,
          memberKind: "PARENT",
          label: type?.name ?? (isWorking ? "Custom shift" : "Off"),
          startLocal,
          endLocal,
          isOff: !isWorking,
          locked: manual.locked,
          source: manual.source === "PATTERN_OVERRIDE" ? "PATTERN" : "MANUAL",
        };
      }

      const pattern = activePatternFor(member.id, date);
      if (pattern) {
        const resolved = resolvePatternDay(date, pattern);
        const isOff = resolved.kind === "O";
        return {
          memberId: member.id,
          name: member.name,
          colorToken: member.colorToken,
          icon: member.icon,
          memberKind: "PARENT",
          label: isOff ? "Off" : `${resolved.kind} ${resolved.startLocal}–${resolved.endLocal}`,
          startLocal: resolved.startLocal,
          endLocal: resolved.endLocal,
          isOff,
          locked: false,
          source: "PATTERN",
        };
      }

      return {
        memberId: member.id,
        name: member.name,
        colorToken: member.colorToken,
        icon: member.icon,
        memberKind: "PARENT",
        label: "Not set up yet",
        startLocal: null,
        endLocal: null,
        isOff: true,
        locked: false,
        source: "NONE",
      };
    });

    const parentEntries = memberEntries.filter((m) => m.memberKind === "PARENT");
    const bothParentsOff = parentEntries.length > 0 && parentEntries.every((m) => m.isOff);

    days.push({
      date,
      members: memberEntries,
      events: eventsByDate.get(date) ?? [],
      bothParentsOff,
    });
    cursor = addDays(cursor, 1);
  }

  return days;
}
