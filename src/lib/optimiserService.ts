import { prisma } from "./prisma";
import {
  DEFAULT_MAX_UNSUPERVISED_MINUTES,
  DEFAULT_PICKUP_BUFFER_MINUTES,
  DEFAULT_SCHOOL_RUN_MORNING_FROM,
  addDays,
  buildTimelineDay,
  evaluateTimeline,
  minutesOrDefault,
  planMumWeek,
  resolvePatternDay,
} from "./engine";
import { activePattern, childInfoFor } from "./householdContext";
import type {
  AdultDay,
  ChildDayInfo,
  HouseholdRuleConfig,
  TimelineGap,
} from "./engine";
import type {
  MumShiftOption,
  OptimiserDay,
  OptimiserResult,
  ShiftInterval,
} from "./engine/mumOptimiser";
import type { ShiftPatternSpec } from "./engine/types";

/**
 * How many days of context the planner loads either side of the range it is
 * planning. One is enough for the real cases: a night shift the evening before
 * runs into the first morning, and a night shift on the last planned day runs
 * into the morning after. Both edges matter, and leaving off the trailing one
 * was how a Sunday-night-into-Monday-morning conflict used to go unnoticed.
 */
const CONTEXT_DAYS = 1;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  timeZone: string;
  ruleConfig: HouseholdRuleConfig;
  /** what this parent may be asked to work: their own, still-active types. */
  shiftOptions: MumShiftOption[];
  /** every shift type in the household, for resolving a saved row's real hours. */
  shiftTypeById: Map<string, { startLocal: string; endLocal: string; paidMinutes: number; name: string }>;
  /** ids from shiftOptions, for rejecting an assignment that isn't one of them. */
  ownerActiveTypeIds: Set<string>;
  activePattern: (id: string, date: string) => ShiftPatternSpec | null;
  workingInterval: (id: string, date: string) => { known: boolean; shift: ShiftInterval | null };
  shiftByKey: Map<string, { locked: boolean; shiftTypeId: string | null; customStart: string | null; customEnd: string | null; paidMinutes: number | null }>;
  childInfoFor: (date: string) => ChildDayInfo[];
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
  const household = await prisma.household.findUnique({ where: { id: householdId } });

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

  // Two different questions, two different sets.
  //
  // RESOLVING a saved shift needs every shift type in the household, archived
  // ones included and whoever owns them: a row that references the other
  // parent's own shift type, or one that has since been archived, still
  // describes real hours somebody really works. Looking it up in a narrower
  // set returned nothing, the times came out null, and the engine read that as
  // a day off - so the planner believed a parent was at home while they were
  // at work, and stopped seeing the conflict. The calendar had always resolved
  // these rows household-wide, which is exactly the disagreement between the
  // two that this rebuild exists to remove.
  //
  // OFFERING a shift to work is a different matter: only the planned parent's
  // own, still-active types may be proposed.
  const allShiftTypes = await prisma.shiftType.findMany({ where: { householdId } });
  const shiftTypeById = new Map(allShiftTypes.map((t) => [t.id, t]));
  const ownerActiveTypeIds = new Set(
    allShiftTypes.filter((t) => t.ownerId === ownerId && !t.archived).map((t) => t.id),
  );
  const shiftOptions: MumShiftOption[] = allShiftTypes
    .filter((t) => t.ownerId === ownerId && !t.archived)
    .map((t) => ({
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
  const ownersWithShiftTypes = new Set(allShiftTypes.map((type) => type.ownerId));

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
    const pattern = activePattern(versionsByOwner, id, date);
    if (pattern) {
      const resolved = resolvePatternDay(date, pattern);
      return {
        known: true,
        shift: resolved.kind !== "O" && resolved.startLocal && resolved.endLocal
          ? { startLocal: resolved.startLocal, endLocal: resolved.endLocal }
          : null,
      };
    }
    // A parent who uses one-tap shift types has a known day off whenever no
    // shift is saved. Keep this in lockstep with calendarService.parentWorkFor.
    if (ownersWithShiftTypes.has(id)) return { known: true, shift: null };
    return { known: false, shift: null };
  }

  return {
    owner,
    otherParent,
    hasChildren: children.length > 0,
    timeZone: household?.timezone ?? "Europe/London",
    ruleConfig: {
      maxUnsupervisedMinutes: childcareRule?.maxUnsupervisedMinutes ?? DEFAULT_MAX_UNSUPERVISED_MINUTES,
      appliesWeekends: childcareRule?.appliesWeekends ?? true,
      minSupervisorAge: childcareRule?.minSupervisorAge ?? null,
      strictPickupAge: childcareRule?.strictPickupAge ?? null,
      pickupBufferMinutes: childcareRule?.pickupBufferMinutes ?? DEFAULT_PICKUP_BUFFER_MINUTES,
      schoolRunMorningFromMinutes: minutesOrDefault(
        childcareRule?.schoolRunMorningFromLocal,
        DEFAULT_SCHOOL_RUN_MORNING_FROM,
      ),
    },
    shiftOptions,
    shiftTypeById,
    ownerActiveTypeIds,
    activePattern: (id, date) => activePattern(versionsByOwner, id, date),
    workingInterval,
    shiftByKey,
    childInfoFor: (date) => childInfoFor(children, date),
  };
}

/**
 * Builds the planning window for one owner over `dates`: the days being
 * planned, plus a context day either side whose shifts are already fixed.
 * Shared by planning and by the check made when a plan is applied, so the two
 * can never be looking at differently-shaped days.
 */
function buildWindow(
  context: HouseholdContext,
  ownerId: string,
  plannedDates: string[],
  /** overrides the owner's shift on the leading context day. */
  priorOwnShiftOverride: ShiftInterval | null | undefined,
): { days: OptimiserDay[]; reportFrom: number; reportTo: number } {
  const windowDates: string[] = [];
  for (let i = CONTEXT_DAYS; i > 0; i--) windowDates.push(addDays(plannedDates[0], -i));
  windowDates.push(...plannedDates);
  for (let i = 1; i <= CONTEXT_DAYS; i++) {
    windowDates.push(addDays(plannedDates[plannedDates.length - 1], i));
  }
  const reportFrom = CONTEXT_DAYS;
  const reportTo = CONTEXT_DAYS + plannedDates.length - 1;

  const days: OptimiserDay[] = windowDates.map((date, index) => {
    const timelineDay = buildTimelineDay(date, context.childInfoFor(date), context.ruleConfig);
    const other = context.otherParent
      ? context.workingInterval(context.otherParent.id, date)
      : { known: true, shift: null };
    const own = context.workingInterval(ownerId, date);

    const ownShiftRow = context.shiftByKey.get(`${ownerId}|${date}`);
    let locked: OptimiserDay["locked"] = null;
    const plannable = index >= reportFrom && index <= reportTo;
    if (plannable && ownShiftRow?.locked) {
      const type = ownShiftRow.shiftTypeId ? context.shiftTypeById.get(ownShiftRow.shiftTypeId) : null;
      const startLocal = type?.startLocal ?? ownShiftRow.customStart ?? null;
      const endLocal = type?.endLocal ?? ownShiftRow.customEnd ?? null;
      const shift = startLocal && endLocal ? { startLocal, endLocal } : null;
      locked = {
        paidMinutes: type?.paidMinutes ?? ownShiftRow.paidMinutes ?? 0,
        shift,
        label: type?.name ?? (shift ? "Custom shift" : "Off"),
      };
    }

    // The leading context day can be overridden when several weeks are planned
    // in one go: the previous week's own suggested Sunday isn't saved anywhere
    // yet, so nothing else would know about it.
    const isLeadingContextDay = index === reportFrom - 1;
    const ownForDay =
      isLeadingContextDay && priorOwnShiftOverride !== undefined
        ? { known: true, shift: priorOwnShiftOverride }
        : own;

    return {
      ...timelineDay,
      hasChildren: context.hasChildren,
      dadKnown: other.known,
      dadShift: other.shift,
      ownKnown: ownForDay.known,
      ownShift: ownForDay.shift,
      locked,
    };
  });

  return { days, reportFrom, reportTo };
}

/**
 * Diagnostics for a plan request that never reached the search at all (no
 * parent, or no weekly-hours target set) - nothing was generated or culled.
 */
const NO_SEARCH_DIAGNOSTICS: OptimiserResult["diagnostics"] = {
  generated: 0,
  rejectedByHours: 0,
  hoursPrunedBranches: 0,
  rejectedByRest: 0,
  rejectedByChildcare: 0,
  safe: 0,
  truncated: false,
  exhaustive: true,
  bestSignature: null,
  candidateCap: 0,
};

/** Builds one week's plan from an already-loaded context - no I/O. */
function computeWeekPlan(
  context: HouseholdContext,
  ownerId: string,
  weekStart: string,
  priorOwnShiftOverride: ShiftInterval | null | undefined,
): MumWeekPlan {
  const { owner, otherParent } = context;
  if (!owner) {
    return {
      best: null,
      alternatives: [],
      bestWithConflicts: null,
      message: "That person isn't a parent in this household.",
      diagnostics: NO_SEARCH_DIAGNOSTICS,
      ownerId,
      ownerName: "",
      otherParentName: null,
      weekStart,
      requiredMinutes: null,
    };
  }

  if (owner.requiredWeeklyMinutes == null) {
    return {
      best: null,
      alternatives: [],
      bestWithConflicts: null,
      message: `Set ${owner.name}'s weekly hours requirement in Settings first, so a plan can hit it exactly.`,
      diagnostics: NO_SEARCH_DIAGNOSTICS,
      ownerId,
      ownerName: owner.name,
      otherParentName: otherParent?.name ?? null,
      weekStart,
      requiredMinutes: null,
    };
  }

  const plannedDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const { days, reportFrom, reportTo } = buildWindow(context, ownerId, plannedDates, priorOwnShiftOverride);

  const result = planMumWeek({
    timeZone: context.timeZone,
    days,
    reportFrom,
    reportTo,
    requiredMinutes: owner.requiredWeeklyMinutes,
    shiftOptions: context.shiftOptions,
    rule: {
      maxUnsupervisedMinutes: context.ruleConfig.maxUnsupervisedMinutes,
      appliesWeekends: context.ruleConfig.appliesWeekends,
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
  priorOwnShiftOverride?: ShiftInterval | null,
): Promise<MumWeekPlan> {
  const context = await loadHouseholdContext(
    householdId,
    ownerId,
    addDays(weekStart, -CONTEXT_DAYS),
    addDays(weekStart, 6 + CONTEXT_DAYS),
  );
  return computeWeekPlan(context, ownerId, weekStart, priorOwnShiftOverride);
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
 * for school - would never be checked at all.
 *
 * Chaining alone is not enough, and never was: the very last week's own
 * Sunday still runs into a Monday nobody is planning. That is why each week is
 * planned over a window with a trailing context day as well (see buildWindow),
 * so the final Sunday is checked against the real, already-known Monday.
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
  const rangeStart = addDays(weekStarts.reduce((a, b) => (a < b ? a : b)), -CONTEXT_DAYS);
  const rangeEnd = addDays(weekStarts.reduce((a, b) => (a > b ? a : b)), 6 + CONTEXT_DAYS);
  const context = await loadHouseholdContext(householdId, ownerId, rangeStart, rangeEnd);

  const results: MumWeekPlan[] = [];
  // undefined = read the real saved state (correct for the very first week too).
  let chainedPriorOwnShift: ShiftInterval | null | undefined = undefined;
  for (const weekStart of weekStarts) {
    const plan = computeWeekPlan(context, ownerId, weekStart, chainedPriorOwnShift);
    results.push(plan);

    // A locked Sunday is already real, saved data - the next week reading it
    // from the database (override = undefined) is exactly as accurate as
    // threading it through here, and simpler. Only an actual PROPOSAL (an
    // unlocked day, shift or off) needs to be threaded forward explicitly,
    // since that's the part nothing has saved yet.
    const sunday = plan.best?.days[6];
    chainedPriorOwnShift = sunday && !sunday.locked
      ? sunday.option
        ? { startLocal: sunday.option.startLocal, endLocal: sunday.option.endLocal }
        : null
      : undefined;
  }
  return results;
}

export type ApplyPlanResult =
  | { applied: number; blocked?: undefined }
  | { applied: 0; blocked: { message: string; conflicts: TimelineGap[] } };

/**
 * Re-checks a set of assignments against the household's childcare rules,
 * exactly as the planner would, before anything is written.
 *
 * This closes the gap between "the plan that was validated" and "the plan that
 * was saved". The browser sends back a list of dates and shift types; without
 * this, nothing server-side would notice if that list had drifted from what
 * was actually checked - a stale sheet left open while a school term or the
 * other parent's rota changed underneath it, or a request made directly
 * against the API. The saved schedule is now validated on the way in, not
 * merely on the way out.
 */
export async function validateAssignments(
  householdId: string,
  ownerId: string,
  assignments: { date: string; shiftTypeId: string | null }[],
): Promise<TimelineGap[]> {
  if (assignments.length === 0) return [];
  const dates = [...assignments.map((a) => a.date)].sort();
  const context = await loadHouseholdContext(
    householdId,
    ownerId,
    addDays(dates[0], -CONTEXT_DAYS),
    addDays(dates[dates.length - 1], CONTEXT_DAYS),
  );

  // Every date from the first assignment to the last, so a gap between two
  // assigned days is still part of the picture.
  const plannedDates: string[] = [];
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) plannedDates.push(d);

  const { days, reportFrom, reportTo } = buildWindow(context, ownerId, plannedDates, undefined);
  const assignmentByDate = new Map(assignments.map((a) => [a.date, a.shiftTypeId]));

  const ownDays: AdultDay[] = days.map((day, i) => {
    if (i < reportFrom || i > reportTo) return { known: day.ownKnown, shift: day.ownShift };
    if (day.locked) return { known: true, shift: day.locked.shift };
    if (!assignmentByDate.has(day.date)) return { known: day.ownKnown, shift: day.ownShift };
    const shiftTypeId = assignmentByDate.get(day.date) ?? null;
    const type = shiftTypeId ? context.shiftTypeById.get(shiftTypeId) : null;
    return {
      known: true,
      shift: type ? { startLocal: type.startLocal, endLocal: type.endLocal } : null,
    };
  });
  const dadDays: AdultDay[] = days.map((day) => ({ known: day.dadKnown, shift: day.dadShift }));

  const result = evaluateTimeline({
    timeZone: context.timeZone,
    days,
    adults: [dadDays, ownDays],
    rule: {
      maxUnsupervisedMinutes: context.ruleConfig.maxUnsupervisedMinutes,
      appliesWeekends: context.ruleConfig.appliesWeekends,
    },
    reportFrom,
    reportTo,
  });
  return result.conflicts;
}

/**
 * Applies a chosen plan: writes the owner's shifts for the week, skipping any
 * locked day (the optimiser never proposes changes to those, and this is a
 * second guard). Days set to "off" in the plan become an explicit off entry.
 *
 * The assignments are re-validated first and refused if they would leave the
 * children uncovered, unless the caller explicitly asks to apply anyway - a
 * deliberate override, never a silent one. Everything is written in a single
 * transaction, so a half-applied week can't exist.
 */
export async function applyMumWeekPlan(
  householdId: string,
  ownerId: string,
  assignments: { date: string; shiftTypeId: string | null }[],
  options: { allowConflicts?: boolean } = {},
): Promise<ApplyPlanResult> {
  const owner = await prisma.familyMember.findFirst({ where: { id: ownerId, householdId, kind: "PARENT" } });
  if (!owner) throw new Error("Not a parent in this household");

  if (!options.allowConflicts) {
    const conflicts = await validateAssignments(householdId, ownerId, assignments);
    if (conflicts.length > 0) {
      return {
        applied: 0,
        blocked: {
          message: `This plan would leave the children without cover: ${conflicts[0].explanation}`,
          conflicts,
        },
      };
    }
  }

  // Resolve every shift type and existing row up front, so the write itself is
  // one short transaction rather than a sequence of round trips per day.
  const dates = assignments.map((a) => new Date(`${a.date}T00:00:00.000Z`));
  const [existingRows, types] = await Promise.all([
    prisma.workShift.findMany({ where: { ownerId, date: { in: dates } } }),
    prisma.shiftType.findMany({
      where: {
        householdId,
        id: { in: assignments.map((a) => a.shiftTypeId).filter((id): id is string => Boolean(id)) },
      },
    }),
  ]);
  const lockedDates = new Set(existingRows.filter((r) => r.locked).map((r) => toDateStr(r.date)));
  const typeById = new Map(types.map((t) => [t.id, t]));

  const writable = assignments.filter((a) => {
    if (lockedDates.has(a.date)) return false; // never overwrite a locked day
    if (a.shiftTypeId && !typeById.has(a.shiftTypeId)) return false; // unknown shift type
    return true;
  });

  await prisma.$transaction(
    writable.map((a) => {
      const date = new Date(`${a.date}T00:00:00.000Z`);
      const paidMinutes = a.shiftTypeId ? typeById.get(a.shiftTypeId)?.paidMinutes ?? null : null;
      return prisma.workShift.upsert({
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
    }),
  );

  return { applied: writable.length };
}
