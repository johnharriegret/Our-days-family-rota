import { prisma } from "./prisma";
import {
  addDays,
  childcareStatus,
  homeIntervalsForDay,
  isSchoolDay,
  nonSchoolDayReason,
  pickupDutyWindows,
  resolvePatternDay,
  subtractIntervals,
} from "./engine";
import { classifyShiftKind, resolveQuickShiftConfig } from "./quickShift";
import type { ChildcareResult, DayInterval, ShiftPatternSpec } from "./engine/types";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Turns a child's non-school-day reason into the label shown when they're
 * not at school - "Home · Half term" instead of a bare "Home" - so the
 * calendar explains WHY, not just that they're off. A school linked with no
 * term dates entered yet keeps the original "add term dates" nudge for any
 * day that isn't otherwise explained (a weekend or bank holiday still shows
 * as such even before term dates exist).
 */
function homeLabelFor(
  reason: ReturnType<typeof nonSchoolDayReason>,
  hasSchoolLinked: boolean,
  hasTerms: boolean,
): string {
  if (!reason) return "Home";
  switch (reason.kind) {
    case "BANK_HOLIDAY":
    case "HOLIDAY":
    case "INSET":
      return `Home · ${reason.label}`;
    case "WEEKEND":
      return "Home · Weekend";
    case "NOT_A_TERM_DAY":
      return "Home";
    case "UNKNOWN":
      return hasSchoolLinked && !hasTerms ? "Home · add term dates" : "Home";
  }
}

/** Whole-number age on `date` from an ISO date-of-birth, or null if unknown. */
function ageOn(date: string, dob: string | null): number | null {
  if (!dob) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [by, bm, bd] = dob.slice(0, 10).split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
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
  /** A parent's quick-fill day/night colour for a working day; null when off/not applicable. */
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
  status: ChildcareResult["status"];
  explanation: string;
  gapStart: string | null;
  gapEnd: string | null;
};

export type CalendarDayView = {
  date: string;
  members: MemberDayEntry[];
  events: CalendarEventEntry[];
  bothParentsOff: boolean;
  /** null when childcare can't be judged (no children, or a parent isn't set up). */
  childcare: CalendarChildcare | null;
};

/**
 * Builds a day-by-day view for [from, to] (inclusive), merging each parent's
 * repeating pattern with any manual override/entry for that date, and each
 * child's school-day status. It also computes per-day childcare cover (Phase 2)
 * on top of the tested lib/engine/childcare.ts, flagging days where the children
 * would be left without an adult beyond the household's allowance.
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
  // A parent who has at least one shift type configured (e.g. Mum's
  // EARLY/LATE/LONG DAY set) but no rota pattern and no manual entry for a
  // given date is treated as off that day, not "unset up" - they work from a
  // one-tap shift list rather than a repeating pattern, so a blank day really
  // does mean a day off. A parent with NEITHER shift types NOR a pattern is
  // genuinely unconfigured and still falls through to "Not set up yet" below,
  // so a half-set-up household never shows a false "both parents off".
  const ownersWithShiftTypes = new Set(shiftTypes.map((t) => t.ownerId));

  // Fetch one day before `from` too, so an overnight shift starting the evening
  // before the range still counts against the first morning's childcare cover.
  const prevDate = new Date(`${addDays(from, -1)}T00:00:00.000Z`);
  const workShifts = await prisma.workShift.findMany({
    where: { householdId, date: { gte: prevDate, lte: toDate } },
  });
  const workShiftByKey = new Map(workShifts.map((s) => [`${s.ownerId}|${toDateStr(s.date)}`, s]));

  const childcareRule = await prisma.childcareRule.findFirst({
    where: { householdId },
    orderBy: { effectiveFrom: "desc" },
  });

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

  type ParentDay = {
    known: boolean;
    working: boolean;
    startLocal: string | null;
    endLocal: string | null;
    isLeave: boolean;
    locked: boolean;
    source: "PATTERN" | "MANUAL" | "NONE";
    label: string;
  };

  // Single source of truth for "what is this parent doing on this date" - used
  // both for the display row and for childcare coverage, so the two can never
  // disagree.
  function parentWorkFor(memberId: string, date: string): ParentDay {
    const manual = workShiftByKey.get(`${memberId}|${date}`);
    if (manual) {
      const type = manual.shiftTypeId ? shiftTypeById.get(manual.shiftTypeId) : null;
      const startLocal = type?.startLocal ?? manual.customStart ?? null;
      const endLocal = type?.endLocal ?? manual.customEnd ?? null;
      const working = Boolean(startLocal && endLocal);
      const isLeave = !working && manual.note === "Annual leave";
      return {
        known: true,
        working,
        startLocal: working ? startLocal : null,
        endLocal: working ? endLocal : null,
        isLeave,
        locked: manual.locked,
        source: manual.source === "PATTERN_OVERRIDE" ? "PATTERN" : "MANUAL",
        label: type?.name ?? (working ? "Custom shift" : isLeave ? "Annual leave" : "Off"),
      };
    }
    const pattern = activePatternFor(memberId, date);
    if (pattern) {
      const resolved = resolvePatternDay(date, pattern);
      const working = resolved.kind !== "O";
      return {
        known: true,
        working,
        startLocal: working ? resolved.startLocal : null,
        endLocal: working ? resolved.endLocal : null,
        isLeave: false,
        locked: false,
        source: "PATTERN",
        label: working ? `${resolved.kind} ${resolved.startLocal}–${resolved.endLocal}` : "Off",
      };
    }
    if (ownersWithShiftTypes.has(memberId)) {
      return {
        known: true,
        working: false,
        startLocal: null,
        endLocal: null,
        isLeave: false,
        locked: false,
        source: "MANUAL",
        label: "Off",
      };
    }
    return {
      known: false,
      working: false,
      startLocal: null,
      endLocal: null,
      isLeave: false,
      locked: false,
      source: "NONE",
      label: "Not set up yet",
    };
  }

  // The minutes-of-day (0-1440) a parent is at HOME on `date`, accounting for an
  // overnight shift that started the evening before spilling into the morning.
  function parentHomeIntervals(memberId: string, date: string): DayInterval[] {
    const today = parentWorkFor(memberId, date);
    const yesterday = parentWorkFor(memberId, addDays(date, -1));
    const todayShift =
      today.working && today.startLocal && today.endLocal
        ? { startLocal: today.startLocal, endLocal: today.endLocal }
        : null;
    const yesterdayShift =
      yesterday.working && yesterday.startLocal && yesterday.endLocal
        ? { startLocal: yesterday.startLocal, endLocal: yesterday.endLocal }
        : null;
    return homeIntervalsForDay(todayShift, yesterdayShift);
  }

  const childMembers = members.filter((m) => m.kind === "CHILD");
  const parentMembers = members.filter((m) => m.kind === "PARENT");

  function childcareForDay(date: string): CalendarChildcare | null {
    if (childMembers.length === 0 || parentMembers.length === 0) return null;
    // Can't judge cover unless every parent's status for the day is actually
    // known. (An unknown previous day just means no overnight shift spills into
    // this morning, which parentHomeIntervals already handles.)
    const allKnown = parentMembers.every((p) => parentWorkFor(p.id, date).known);
    if (!allKnown) return null;

    // An adult is home during the complement of their away-at-work time.
    const covered: DayInterval[] = [];
    for (const p of parentMembers) {
      for (const home of parentHomeIntervals(p.id, date)) covered.push(home);
    }

    // School only covers the children while EVERY child is at school - a child at
    // home still needs an adult - so use the intersection of their school hours.
    const childSchool = childMembers.map((c) => {
      const terms =
        c.school?.terms.map((t) => ({
          startDate: toDateStr(t.startDate),
          endDate: toDateStr(t.endDate),
          type: t.type,
          label: t.label,
          weekdays: t.weekdays,
        })) ?? [];
      const at = c.school ? isSchoolDay(date, terms) : false;
      const reason = c.school && !at ? nonSchoolDayReason(date, terms) : null;
      return {
        at,
        start: c.school ? toMinutes(c.school.startLocal) : 0,
        end: c.school ? toMinutes(c.school.endLocal) : 0,
        hasSchool: Boolean(c.school),
        reason,
      };
    });
    if (childSchool.every((c) => c.at)) {
      const start = Math.max(...childSchool.map((c) => c.start));
      const end = Math.min(...childSchool.map((c) => c.end));
      if (end > start) covered.push({ startMinutes: start, endMinutes: end });
    }

    // A hard exception to the morning-handover rule: if EVERY child who's
    // actually enrolled in a school is off for a recognised school holiday,
    // INSET day, or bank holiday (not just "it's the weekend", which is
    // handled separately below), there's no school run to miss, so a
    // before-school gap is allowed the same way a weekend gap is. An
    // ordinary school day never sets this, so the pre-existing hard rule
    // stands: a handover gap with nobody home is CHILDCARE_NEEDED regardless
    // of the 3-hour allowance, since the kids need help getting ready for
    // school.
    const schoolLinked = childSchool.filter((c) => c.hasSchool);
    const isSchoolHoliday =
      schoolLinked.length > 0 &&
      schoolLinked.every(
        (c) => c.reason?.kind === "BANK_HOLIDAY" || c.reason?.kind === "HOLIDAY" || c.reason?.kind === "INSET",
      );

    // Minutes a supervisor-age child is at home (and could supervise): the whole
    // day when they're off school, or before/after school on a school day.
    const minSupervisorAge = childcareRule?.minSupervisorAge ?? null;
    const supervisorHome: DayInterval[] = [];
    if (minSupervisorAge != null) {
      childMembers.forEach((c, i) => {
        const age = ageOn(date, c.dateOfBirth ? toDateStr(c.dateOfBirth) : null);
        if (age == null || age < minSupervisorAge) return;
        if (childSchool[i].at) {
          if (childSchool[i].start > 0) supervisorHome.push({ startMinutes: 0, endMinutes: childSchool[i].start });
          if (childSchool[i].end < 1440) supervisorHome.push({ startMinutes: childSchool[i].end, endMinutes: 1440 });
        } else {
          supervisorHome.push({ startMinutes: 0, endMinutes: 1440 });
        }
      });
    }

    // Below strictPickupAge, a sibling can never substitute for an adult
    // specifically around that child's own school drop-off/pick-up - carve
    // those buffer windows out of the sibling allowance, whoever else is home.
    const strictPickupAge = childcareRule?.strictPickupAge ?? null;
    const pickupBufferMinutes = childcareRule?.pickupBufferMinutes ?? 30;
    let pickupWindows: DayInterval[] = [];
    if (strictPickupAge != null) {
      childMembers.forEach((c, i) => {
        const age = ageOn(date, c.dateOfBirth ? toDateStr(c.dateOfBirth) : null);
        if (age == null || age >= strictPickupAge || !c.school) return;
        pickupWindows = pickupWindows.concat(
          pickupDutyWindows({
            attendsSchoolToday: childSchool[i].at,
            schoolStartMinutes: childSchool[i].start,
            schoolEndMinutes: childSchool[i].end,
            bufferMinutes: pickupBufferMinutes,
          }),
        );
      });
    }
    const restrictedSupervisorHome = subtractIntervals(supervisorHome, pickupWindows);

    const result = childcareStatus({
      date,
      coveredIntervals: covered,
      supervisorHome: restrictedSupervisorHome,
      rule: {
        maxUnsupervisedMinutes: childcareRule?.maxUnsupervisedMinutes ?? 180,
        appliesWeekends: childcareRule?.appliesWeekends ?? true,
        minSupervisorAge,
      },
      isSchoolHoliday,
    });
    return {
      status: result.status,
      explanation: result.explanation,
      gapStart: result.gapStart,
      gapEnd: result.gapEnd,
    };
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
            weekdays: t.weekdays,
          })) ?? [];
        const hasTerms = terms.length > 0;
        const atSchool = member.school ? isSchoolDay(date, terms) : false;
        // Distinguish "definitely home" (we have term dates and this isn't a
        // school day) from "we don't know yet" (a school is linked but no term
        // dates have been entered), and explain WHY on a non-school day (half
        // term, INSET, bank holiday, weekend) instead of a bare "Home".
        const reason = atSchool ? null : nonSchoolDayReason(date, terms);
        const homeLabel = homeLabelFor(reason, Boolean(member.school), hasTerms);
        return {
          memberId: member.id,
          name: member.name,
          colorToken: member.colorToken,
          icon: member.icon,
          memberKind: "CHILD",
          label: atSchool ? `School ${member.school!.startLocal}–${member.school!.endLocal}` : homeLabel,
          startLocal: atSchool ? member.school!.startLocal : null,
          endLocal: atSchool ? member.school!.endLocal : null,
          isOff: !atSchool,
          locked: false,
          source: "SCHOOL",
          displayColor: null,
        };
      }

      const pd = parentWorkFor(member.id, date);
      const quickShift = resolveQuickShiftConfig(member);
      const displayColor =
        pd.working && pd.startLocal && pd.endLocal
          ? classifyShiftKind(pd.startLocal, pd.endLocal) === "NIGHT"
            ? quickShift.nightColor
            : quickShift.dayColor
          : null;
      return {
        memberId: member.id,
        name: member.name,
        colorToken: member.colorToken,
        icon: member.icon,
        memberKind: "PARENT" as const,
        label: pd.label,
        startLocal: pd.startLocal,
        endLocal: pd.endLocal,
        isOff: !pd.working,
        locked: pd.locked,
        source: pd.source,
        displayColor,
      };
    });

    const parentEntries = memberEntries.filter((m) => m.memberKind === "PARENT");
    // "Both off" must be positively known for EVERY parent - a parent with no
    // rota and no shift for the day (source "NONE") is unknown, not off, so a
    // half-configured household never gets a false "both parents off together".
    const everyParentKnown =
      parentEntries.length > 0 && parentEntries.every((m) => m.source !== "NONE");
    const bothParentsOff = everyParentKnown && parentEntries.every((m) => m.isOff);

    days.push({
      date,
      members: memberEntries,
      events: eventsByDate.get(date) ?? [],
      bothParentsOff,
      childcare: childcareForDay(date),
    });
    cursor = addDays(cursor, 1);
  }

  return days;
}
