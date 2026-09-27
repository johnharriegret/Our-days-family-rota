import { prisma } from "./prisma";
import {
  DEFAULT_MAX_UNSUPERVISED_MINUTES,
  DEFAULT_PICKUP_BUFFER_MINUTES,
  DEFAULT_SCHOOL_RUN_MORNING_FROM,
  addDays,
  buildTimelineDay,
  evaluateTimeline,
  isSchoolDay,
  minutesOrDefault,
  nonSchoolDayReason,
  resolvePatternDay,
} from "./engine";
import { activePattern, childInfoFor } from "./householdContext";
import { classifyShiftKind, resolveQuickShiftConfig } from "./quickShift";
import type { AdultDay, TimelineDay } from "./engine";
import type { ChildcareResult, ShiftPatternSpec } from "./engine/types";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  // The household's own timezone drives every wall-clock-to-real-time
  // conversion, so a gap that spans the night the clocks change is measured in
  // the hours it actually lasted.
  const household = await prisma.household.findUnique({ where: { id: householdId } });

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

  // Fetch one day either side of the range. The day before matters because an
  // overnight shift starting that evening runs into the first morning; the day
  // after matters because a shift on the LAST day can run into the morning
  // after it, and a conflict there is still caused by this range's shifts.
  // Without both, the first and last days of any view report a childcare
  // result computed from an incomplete picture.
  const contextFrom = addDays(from, -1);
  const contextTo = addDays(to, 1);
  const workShifts = await prisma.workShift.findMany({
    where: {
      householdId,
      date: {
        gte: new Date(`${contextFrom}T00:00:00.000Z`),
        lte: new Date(`${contextTo}T00:00:00.000Z`),
      },
    },
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
    const pattern = activePattern(patternVersionsByOwner, memberId, date);
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

  const childMembers = members.filter((m) => m.kind === "CHILD");
  const parentMembers = members.filter((m) => m.kind === "PARENT");


  // Childcare is judged once, over one continuous timeline covering the
  // requested range plus a context day either side - never day by day, and
  // never week by week. That is what lets a stretch of unattended time that
  // crosses midnight (or a Sunday night shift running into Monday morning) be
  // seen as the single long stretch it really is.
  const ruleConfig = {
    maxUnsupervisedMinutes: childcareRule?.maxUnsupervisedMinutes ?? DEFAULT_MAX_UNSUPERVISED_MINUTES,
    appliesWeekends: childcareRule?.appliesWeekends ?? true,
    minSupervisorAge: childcareRule?.minSupervisorAge ?? null,
    strictPickupAge: childcareRule?.strictPickupAge ?? null,
    pickupBufferMinutes: childcareRule?.pickupBufferMinutes ?? DEFAULT_PICKUP_BUFFER_MINUTES,
    schoolRunMorningFromMinutes: minutesOrDefault(
      childcareRule?.schoolRunMorningFromLocal,
      DEFAULT_SCHOOL_RUN_MORNING_FROM,
    ),
  };

  const windowDates: string[] = [];
  for (let d = contextFrom; d <= contextTo; d = addDays(d, 1)) windowDates.push(d);

  const timelineDays: TimelineDay[] = windowDates.map((date) =>
    buildTimelineDay(date, childInfoFor(childMembers, date), ruleConfig),
  );
  const adults: AdultDay[][] = parentMembers.map((p) =>
    windowDates.map((date) => {
      const pd = parentWorkFor(p.id, date);
      return {
        known: pd.known,
        shift:
          pd.working && pd.startLocal && pd.endLocal
            ? { startLocal: pd.startLocal, endLocal: pd.endLocal }
            : null,
      };
    }),
  );

  const childcareByDate: Record<string, ChildcareResult | null> =
    parentMembers.length > 0
      ? evaluateTimeline({
          timeZone: household?.timezone ?? "Europe/London",
          days: timelineDays,
          adults,
          rule: {
            maxUnsupervisedMinutes: ruleConfig.maxUnsupervisedMinutes,
            appliesWeekends: ruleConfig.appliesWeekends,
          },
          reportFrom: 1,
          reportTo: windowDates.length - 2,
        }).byDate
      : {};

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
      childcare: (() => {
        const result = childcareByDate[date] ?? null;
        return result
          ? {
              status: result.status,
              explanation: result.explanation,
              gapStart: result.gapStart,
              gapEnd: result.gapEnd,
            }
          : null;
      })(),
    });
    cursor = addDays(cursor, 1);
  }

  return days;
}
