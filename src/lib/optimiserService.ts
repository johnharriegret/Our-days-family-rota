import { prisma } from "./prisma";
import { addDays, isSchoolDay, nonSchoolDayReason, pickupDutyWindows, planMumWeek, resolvePatternDay, subtractIntervals } from "./engine";
import type {
  MumShiftOption,
  OptimiserDay,
  OptimiserResult,
  ShiftInterval,
} from "./engine/mumOptimiser";
import type { DayInterval, ShiftPatternSpec } from "./engine/types";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function ageOn(date: string, dob: string | null): number | null {
  if (!dob) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [by, bm, bd] = dob.slice(0, 10).split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

export type MumWeekPlan = OptimiserResult & {
  ownerId: string;
  ownerName: string;
  /** the other parent's name, for labelling their own shift shown alongside the plan - null if there isn't one. */
  otherParentName: string | null;
  weekStart: string;
  requiredMinutes: number | null;
};

type HouseholdContext = {
  owner: { id: string; name: string; requiredWeeklyMinutes: number | null } | null;
  otherParent: { id: string; name: string } | null;
  hasChildren: boolean;
  childcareRule: {
    maxUnsupervisedMinutes: number | null;
    appliesWeekends: boolean | null;
    minSupervisorAge: number | null;
    strictPickupAge: number | null;
    pickupBufferMinutes: number | null;
  } | null;
  shiftOptions: MumShiftOption[];
  shiftTypeById: Map<string, { startLocal: string; endLocal: string; paidMinutes: number; name: string }>;
  activePattern: (id: string, date: string) => ShiftPatternSpec | null;
  workingInterval: (id: string, date: string) => { known: boolean; shift: ShiftInterval | null };
  shiftByKey: Map<string, { locked: boolean; shiftTypeId: string | null; customStart: string | null; customEnd: string | null; paidMinutes: number | null }>;
  childInfoFor: (date: string) => {
    at: boolean;
    start: number;
    end: number;
    dob: string | null;
    hasSchool: boolean;
    reason: ReturnType<typeof nonSchoolDayReason>;
  }[];
};

/**
 * Loads everything needed to plan any number of weeks for one owner, in one
 * batch of queries covering the WHOLE requested date range - not one query
 * batch per week. Planning a single week and planning a whole year go
 * through the exact same function; the year just asks for a wider range.
 */
async function loadHouseholdContext(
  householdId: string,
  ownerId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<HouseholdContext> {
  const owner = await prisma.familyMember.findFirst({
    where: { id: ownerId, householdId, kind: "PARENT" },
  });

  const otherParents = await prisma.familyMember.findMany({
    where: { householdId, kind: "PARENT", archived: false, id: { not: ownerId } },
  });
  const otherParent = otherParents[0] ?? null;

  const children = await prisma.familyMember.findMany({
    where: { householdId, kind: "CHILD", archived: false },
    include: { school: { include: { terms: true } } },
  });

  const childcareRule = await prisma.childcareRule.findFirst({
    where: { householdId },
    orderBy: { effectiveFrom: "desc" },
  });

  const shiftTypes = await prisma.shiftType.findMany({ where: { householdId, ownerId, archived: false } });
  const shiftTypeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const shiftOptions: MumShiftOption[] = shiftTypes.map((t) => ({
    id: t.id,
    name: t.name,
    startLocal: t.startLocal,
    endLocal: t.endLocal,
    paidMinutes: t.paidMinutes,
  }));

  const relevantIds = [ownerId, ...(otherParent ? [otherParent.id] : [])];
  const patterns = await prisma.shiftPattern.findMany({
    where: { householdId, ownerId: { in: relevantIds } },
    include: { blocks: { orderBy: { order: "asc" } } },
    orderBy: { effectiveFrom: "asc" },
  });
  const versionsByOwner = new Map<string, { effectiveFrom: string; spec: ShiftPatternSpec }[]>();
  for (const p of patterns) {
    const list = versionsByOwner.get(p.ownerId) ?? [];
    list.push({
      effectiveFrom: toDateStr(p.effectiveFrom),
      spec: {
        anchor: toDateStr(p.anchor),
        blocks: p.blocks.map((b) => ({ kind: b.kind, count: b.count, startLocal: b.startLocal, endLocal: b.endLocal })),
      },
    });
    versionsByOwner.set(p.ownerId, list);
  }
  function activePattern(id: string, date: string): ShiftPatternSpec | null {
    const versions = versionsByOwner.get(id);
    if (!versions) return null;
    let active: ShiftPatternSpec | null = null;
    for (const v of versions) {
      if (v.effectiveFrom <= date) active = v.spec;
      else break;
    }
    return active;
  }

  const shifts = await prisma.workShift.findMany({
    where: {
      householdId,
      ownerId: { in: relevantIds },
      date: { gte: new Date(`${rangeStart}T00:00:00.000Z`), lte: new Date(`${rangeEnd}T00:00:00.000Z`) },
    },
  });
  const shiftByKey = new Map(shifts.map((s) => [`${s.ownerId}|${toDateStr(s.date)}`, s]));

  function workingInterval(id: string, date: string): { known: boolean; shift: ShiftInterval | null } {
    const manual = shiftByKey.get(`${id}|${date}`);
    if (manual) {
      const type = manual.shiftTypeId ? shiftTypeById.get(manual.shiftTypeId) : null;
      const startLocal = type?.startLocal ?? manual.customStart ?? null;
      const endLocal = type?.endLocal ?? manual.customEnd ?? null;
      return { known: true, shift: startLocal && endLocal ? { startLocal, endLocal } : null };
    }
    const pattern = activePattern(id, date);
    if (pattern) {
      const resolved = resolvePatternDay(date, pattern);
      return {
        known: true,
        shift: resolved.kind !== "O" && resolved.startLocal && resolved.endLocal
          ? { startLocal: resolved.startLocal, endLocal: resolved.endLocal }
          : null,
      };
    }
    return { known: false, shift: null };
  }

  function childInfoFor(date: string) {
    return children.map((c) => {
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
        dob: c.dateOfBirth ? toDateStr(c.dateOfBirth) : null,
        hasSchool: Boolean(c.school),
        reason,
      };
    });
  }

  return {
    owner,
    otherParent,
    hasChildren: children.length > 0,
    childcareRule,
    shiftOptions,
    shiftTypeById,
    activePattern,
    workingInterval,
    shiftByKey,
    childInfoFor,
  };
}

/** Builds one week's plan from an already-loaded context - no I/O. */
function computeWeekPlan(
  context: HouseholdContext,
  ownerId: string,
  weekStart: string,
  priorMumShiftOverride: ShiftInterval | null | undefined,
): MumWeekPlan {
  const { owner, otherParent, childcareRule } = context;
  if (!owner) {
    return { best: null, alternatives: [], message: "That person isn't a parent in this household.", ownerId, ownerName: "", otherParentName: null, weekStart, requiredMinutes: null };
  }

  const rangeStart = addDays(weekStart, -1);
  const minSupervisorAge = childcareRule?.minSupervisorAge ?? null;
  const strictPickupAge = childcareRule?.strictPickupAge ?? null;
  const pickupBufferMinutes = childcareRule?.pickupBufferMinutes ?? 30;

  const optimiserDays: OptimiserDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const other = otherParent ? context.workingInterval(otherParent.id, date) : { known: true, shift: null };
    const childInfo = context.childInfoFor(date);

    let schoolCover: DayInterval | null = null;
    if (childInfo.length > 0 && childInfo.every((c) => c.at)) {
      const start = Math.max(...childInfo.map((c) => c.start));
      const end = Math.min(...childInfo.map((c) => c.end));
      if (end > start) schoolCover = { startMinutes: start, endMinutes: end };
    }
    // A hard exception to the morning-handover rule: every school-linked
    // child off for a recognised holiday/INSET/bank holiday (not merely a
    // weekend) means there's no school run to miss (mirrors calendarService's
    // childcareForDay, so the plan sheet and the calendar agree).
    const schoolLinked = childInfo.filter((c) => c.hasSchool);
    const isSchoolHoliday =
      schoolLinked.length > 0 &&
      schoolLinked.every(
        (c) => c.reason?.kind === "BANK_HOLIDAY" || c.reason?.kind === "HOLIDAY" || c.reason?.kind === "INSET",
      );
    const supervisorHome: DayInterval[] = [];
    if (minSupervisorAge != null) {
      for (const c of childInfo) {
        if ((ageOn(date, c.dob) ?? -1) < minSupervisorAge) continue;
        if (c.at) {
          if (c.start > 0) supervisorHome.push({ startMinutes: 0, endMinutes: c.start });
          if (c.end < 1440) supervisorHome.push({ startMinutes: c.end, endMinutes: 1440 });
        } else {
          supervisorHome.push({ startMinutes: 0, endMinutes: 1440 });
        }
      }
    }
    let pickupWindows: DayInterval[] = [];
    if (strictPickupAge != null) {
      for (const c of childInfo) {
        const age = ageOn(date, c.dob);
        if (age == null || age >= strictPickupAge || !c.hasSchool) continue;
        pickupWindows = pickupWindows.concat(
          pickupDutyWindows({
            attendsSchoolToday: c.at,
            schoolStartMinutes: c.start,
            schoolEndMinutes: c.end,
            bufferMinutes: pickupBufferMinutes,
          }),
        );
      }
    }
    const restrictedSupervisorHome = subtractIntervals(supervisorHome, pickupWindows);

    const ownShift = context.shiftByKey.get(`${ownerId}|${date}`);
    let locked: OptimiserDay["locked"] = null;
    if (ownShift?.locked) {
      const type = ownShift.shiftTypeId ? context.shiftTypeById.get(ownShift.shiftTypeId) : null;
      const startLocal = type?.startLocal ?? ownShift.customStart ?? null;
      const endLocal = type?.endLocal ?? ownShift.customEnd ?? null;
      const shift = startLocal && endLocal ? { startLocal, endLocal } : null;
      locked = {
        paidMinutes: type?.paidMinutes ?? ownShift.paidMinutes ?? 0,
        shift,
        label: type?.name ?? (shift ? "Custom shift" : "Off"),
      };
    }

    optimiserDays.push({
      date,
      isWeekend: false,
      hasChildren: context.hasChildren,
      dadKnown: other.known,
      dadShift: other.shift,
      locked,
      schoolCover,
      supervisorHome: restrictedSupervisorHome,
      isSchoolHoliday,
    });
  }

  const priorDadShift = otherParent ? context.workingInterval(otherParent.id, rangeStart).shift : null;
  const priorMumShift = priorMumShiftOverride !== undefined ? priorMumShiftOverride : context.workingInterval(ownerId, rangeStart).shift;

  if (owner.requiredWeeklyMinutes == null) {
    return {
      best: null,
      alternatives: [],
      message: `Set ${owner.name}'s weekly hours requirement in Settings first, so a plan can hit it exactly.`,
      ownerId,
      ownerName: owner.name,
      otherParentName: otherParent?.name ?? null,
      weekStart,
      requiredMinutes: null,
    };
  }

  const result = planMumWeek({
    days: optimiserDays,
    priorDadShift,
    priorMumShift,
    requiredMinutes: owner.requiredWeeklyMinutes,
    shiftOptions: context.shiftOptions,
    rule: {
      maxUnsupervisedMinutes: childcareRule?.maxUnsupervisedMinutes ?? 180,
      appliesWeekends: childcareRule?.appliesWeekends ?? true,
    },
  });

  return {
    ...result,
    ownerId,
    ownerName: owner.name,
    otherParentName: otherParent?.name ?? null,
    weekStart,
    requiredMinutes: owner.requiredWeeklyMinutes,
  };
}

/**
 * Gathers a household's real data for the week and runs the deterministic
 * shift optimiser (spec §6). Read-only: it returns recommendations, it never
 * writes shifts.
 */
export async function getMumWeekPlan(
  householdId: string,
  ownerId: string,
  weekStart: string,
  /**
   * Overrides what the day before this week looked like for this owner,
   * instead of reading it from the database. Used when planning several
   * consecutive weeks in one go (see getMumMonthPlan below): a week's own
   * suggested-but-not-yet-applied Sunday shift wouldn't otherwise be visible
   * to the next week's plan at all, since nothing's been saved yet. Pass
   * `undefined` (the default) to read the real saved state as normal, or
   * `null` explicitly for "the day before was a proposed day off".
   */
  priorMumShiftOverride?: ShiftInterval | null,
): Promise<MumWeekPlan> {
  const weekEnd = addDays(weekStart, 6);
  const rangeStart = addDays(weekStart, -1);
  const context = await loadHouseholdContext(householdId, ownerId, rangeStart, weekEnd);
  return computeWeekPlan(context, ownerId, weekStart, priorMumShiftOverride);
}

/**
 * Plans several consecutive weeks together (the "Plan the month"/"Plan the
 * year" flow), chaining each week's own suggested Sunday into the next
 * week's "day before" input instead of letting every week read the database
 * in isolation.
 *
 * This matters because nothing is saved until the user taps Apply: without
 * chaining, a week suggesting a Sunday night shift and the FOLLOWING week's
 * Monday would each look independently fine, while the household's actual
 * combined situation - a parent still finishing a night shift right when the
 * other leaves for a day shift, with children who need help getting ready
 * for school - would never be checked at all. Fixes a real reported case:
 * a Sunday night shift suggested with no visibility into Monday's already-
 * known day shift and school run.
 *
 * All the weeks share ONE batch of queries covering the whole requested
 * range (see loadHouseholdContext), not one query batch per week - the only
 * way planning a full year stays fast instead of doing hundreds of
 * sequential round trips to the database.
 */
export async function getMumMonthPlan(
  householdId: string,
  ownerId: string,
  weekStarts: string[],
): Promise<MumWeekPlan[]> {
  if (weekStarts.length === 0) return [];
  const rangeStart = addDays(weekStarts.reduce((a, b) => (a < b ? a : b)), -1);
  const rangeEnd = addDays(weekStarts.reduce((a, b) => (a > b ? a : b)), 6);
  const context = await loadHouseholdContext(householdId, ownerId, rangeStart, rangeEnd);

  const results: MumWeekPlan[] = [];
  // undefined = read the real saved state (correct for the very first week too).
  let chainedPriorMumShift: ShiftInterval | null | undefined = undefined;
  for (const weekStart of weekStarts) {
    const plan = computeWeekPlan(context, ownerId, weekStart, chainedPriorMumShift);
    results.push(plan);

    const sunday = plan.best?.days[6];
    // A locked Sunday is already real, saved data - the next week reading it
    // from the database (override = undefined) is exactly as accurate as
    // threading it through here, and simpler. Only an actual PROPOSAL (an
    // unlocked day, shift or off) needs to be threaded forward explicitly,
    // since that's the part nothing has saved yet.
    chainedPriorMumShift = sunday && !sunday.locked
      ? sunday.option
        ? { startLocal: sunday.option.startLocal, endLocal: sunday.option.endLocal }
        : null
      : undefined;
  }
  return results;
}

/**
 * Applies a chosen plan: writes the owner's shifts for the week, skipping any
 * locked day (the optimiser never proposes changes to those, and this is a
 * second guard). Days set to "off" in the plan become an explicit off entry.
 */
export async function applyMumWeekPlan(
  householdId: string,
  ownerId: string,
  assignments: { date: string; shiftTypeId: string | null }[],
): Promise<{ applied: number }> {
  const owner = await prisma.familyMember.findFirst({ where: { id: ownerId, householdId, kind: "PARENT" } });
  if (!owner) throw new Error("Not a parent in this household");

  let applied = 0;
  for (const a of assignments) {
    const date = new Date(`${a.date}T00:00:00.000Z`);
    const existing = await prisma.workShift.findUnique({ where: { ownerId_date: { ownerId, date } } });
    if (existing?.locked) continue; // never overwrite a locked day

    let paidMinutes: number | null = null;
    if (a.shiftTypeId) {
      const type = await prisma.shiftType.findFirst({ where: { id: a.shiftTypeId, householdId } });
      if (!type) continue;
      paidMinutes = type.paidMinutes;
    }
    await prisma.workShift.upsert({
      where: { ownerId_date: { ownerId, date } },
      create: {
        householdId,
        ownerId,
        date,
        shiftTypeId: a.shiftTypeId,
        paidMinutes,
        source: "MANUAL",
      },
      update: { shiftTypeId: a.shiftTypeId, customStart: null, customEnd: null, paidMinutes, source: "MANUAL" },
    });
    applied += 1;
  }
  return { applied };
}
