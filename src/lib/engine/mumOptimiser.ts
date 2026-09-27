import { childcareStatus } from "./childcare";
import { homeIntervalsForDay } from "./coverage";
import type { ChildcareStatus, DayInterval } from "./types";

// A deterministic, rules-based optimiser for one parent's variable week (spec
// §6, "Plan Mum's Week"). It never invents scheduling maths with AI: it
// enumerates real shift combinations that hit the hard weekly-hours requirement
// and ranks them by the spec's priority order. It only RECOMMENDS - applying a
// plan is a separate, explicit step - and it never proposes a change to a day
// the user has locked.

export type ShiftInterval = { startLocal: string; endLocal: string };

export type MumShiftOption = {
  id: string;
  name: string;
  startLocal: string;
  endLocal: string;
  paidMinutes: number;
};

export type OptimiserDay = {
  date: string;
  isWeekend: boolean;
  hasChildren: boolean;
  /** true once the other parent's status for this day is actually known. */
  dadKnown: boolean;
  /** the other parent's working interval, or null if they're home that day. */
  dadShift: ShiftInterval | null;
  /** locked shift the optimiser must keep as-is; shift null = locked day off. */
  locked: { paidMinutes: number; shift: ShiftInterval | null; label?: string } | null;
  /** interval during which EVERY child is at school (null if any child is home). */
  schoolCover: DayInterval | null;
  /** a supervisor-age child is home (not at school) today - enables the allowance. */
  supervisorHomeAllowance: boolean;
};

export type OptimiserInput = {
  days: OptimiserDay[];
  /** the other parent's / this parent's shift the day BEFORE the week, for overnight spill. */
  priorDadShift: ShiftInterval | null;
  priorMumShift: ShiftInterval | null;
  requiredMinutes: number;
  shiftOptions: MumShiftOption[];
  rule: { maxUnsupervisedMinutes: number; appliesWeekends: boolean };
  maxAlternatives?: number;
};

export type PlanDay = {
  date: string;
  /** null = day off in this plan. */
  option: MumShiftOption | null;
  locked: boolean;
  /** display name for a locked day (e.g. "Long Day" or "Off"). */
  lockedLabel: string | null;
};

export type PlanMetrics = {
  totalPaidMinutes: number;
  requiredMinutes: number;
  hoursExact: boolean;
  childcareConflicts: number;
  handoverDays: number;
  bothParentsWorkingDays: number;
  /** days both parents are off together (family time). */
  familyDaysTogether: number;
  /** subset of the above where the children are at school = couple daytime. */
  coupleDaytimeOff: number;
};

export type WeekPlan = {
  days: PlanDay[];
  metrics: PlanMetrics;
};

export type OptimiserResult = {
  best: WeekPlan | null;
  alternatives: WeekPlan[];
  /** set when no plan could be produced, with a plain-English reason. */
  message?: string;
};

/** Childcare status for one day given both parents' shifts (and the night before). */
function dayChildcare(
  day: OptimiserDay,
  mumToday: ShiftInterval | null,
  mumYesterday: ShiftInterval | null,
  dadYesterday: ShiftInterval | null,
  rule: { maxUnsupervisedMinutes: number; appliesWeekends: boolean },
): ChildcareStatus | null {
  if (!day.hasChildren || !day.dadKnown) return null;
  const covered: DayInterval[] = [
    ...homeIntervalsForDay(day.dadShift, dadYesterday),
    ...homeIntervalsForDay(mumToday, mumYesterday),
  ];
  if (day.schoolCover) covered.push(day.schoolCover);
  const result = childcareStatus({
    date: day.date,
    coveredIntervals: covered,
    oldestChildHome: day.supervisorHomeAllowance,
    rule: { ...rule, minSupervisorAge: null },
  });
  return result.status;
}

function shiftOf(option: MumShiftOption | null): ShiftInterval | null {
  return option ? { startLocal: option.startLocal, endLocal: option.endLocal } : null;
}

function evaluate(
  input: OptimiserInput,
  chosen: (MumShiftOption | null)[],
): WeekPlan {
  const { days, rule } = input;
  let totalPaid = 0;
  let conflicts = 0;
  let handovers = 0;
  let bothWorking = 0;
  let familyDays = 0;
  let coupleDaytime = 0;

  const planDays: PlanDay[] = days.map((day, i) => {
    const locked = day.locked;
    const option = locked ? null : chosen[i];
    // paid minutes: a locked day contributes its own paid total.
    totalPaid += locked ? locked.paidMinutes : option?.paidMinutes ?? 0;

    const mumToday: ShiftInterval | null = locked ? locked.shift : shiftOf(option);
    const mumYesterday: ShiftInterval | null =
      i > 0
        ? days[i - 1].locked
          ? days[i - 1].locked!.shift
          : shiftOf(chosen[i - 1])
        : input.priorMumShift;
    const dadYesterday = i > 0 ? days[i - 1].dadShift : input.priorDadShift;

    const status = dayChildcare(day, mumToday, mumYesterday, dadYesterday, rule);
    if (status === "CHILDCARE_NEEDED") conflicts += 1;
    if (status === "HANDOVER") handovers += 1;

    const mumWorking = Boolean(mumToday);
    const dadWorking = Boolean(day.dadShift);
    if (mumWorking && dadWorking) bothWorking += 1;
    if (!mumWorking && !dadWorking && day.dadKnown) {
      familyDays += 1;
      // Both parents off AND the children are at school = daytime the couple
      // gets to themselves. This is the outcome the household most wants, so it
      // is tracked and rewarded separately from an ordinary shared day off.
      if (day.schoolCover) coupleDaytime += 1;
    }

    return {
      date: day.date,
      option: locked ? null : option,
      locked: Boolean(locked),
      lockedLabel: locked ? locked.label ?? (locked.shift ? "Shift" : "Off") : null,
    };
  });

  return {
    days: planDays,
    metrics: {
      totalPaidMinutes: totalPaid,
      requiredMinutes: input.requiredMinutes,
      hoursExact: totalPaid === input.requiredMinutes,
      childcareConflicts: conflicts,
      handoverDays: handovers,
      bothParentsWorkingDays: bothWorking,
      familyDaysTogether: familyDays,
      coupleDaytimeOff: coupleDaytime,
    },
  };
}

/** Number of separate runs of consecutive working days (lower = less fragmented). */
function workingRuns(chosen: (MumShiftOption | null)[], days: OptimiserDay[]): number {
  let runs = 0;
  let prevWorking = false;
  for (let i = 0; i < days.length; i++) {
    const locked = days[i].locked;
    const working = locked ? Boolean(locked.shift) : Boolean(chosen[i]);
    if (working && !prevWorking) runs += 1;
    prevWorking = working;
  }
  return runs;
}

/**
 * Lexicographic ranking key (lower is better). The household's overriding goal
 * is more time off TOGETHER, so after the two hard requirements the ranking
 * actively MAXIMISES shared time off rather than minimising both-working:
 *   1. exact weekly hours (spec priority 1)
 *   2. fewest childcare conflicts (spec priority 2 - a safety constraint)
 *   3. most couple-daytime-off days (both parents off while the kids are at
 *      school) - the premium outcome the family is optimising for
 *   4. most shared days off overall (family time together)
 *   5. fewest handover days
 *   6. least fragmented working week
 * Both-parents-working days are deliberately NOT penalised on their own: a day
 * both work while the children are safely at school actually PROTECTS a shared
 * day off elsewhere, and the genuinely bad case (both working with a child home)
 * is already caught by the childcare-conflict count above.
 */
function rankKey(plan: WeekPlan, chosen: (MumShiftOption | null)[], days: OptimiserDay[]): number[] {
  const m = plan.metrics;
  return [
    Math.abs(m.totalPaidMinutes - m.requiredMinutes),
    m.childcareConflicts,
    -m.coupleDaytimeOff,
    -m.familyDaysTogether,
    m.handoverDays,
    workingRuns(chosen, days),
  ];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function signature(chosen: (MumShiftOption | null)[]): string {
  return chosen.map((o) => o?.id ?? "-").join("|");
}

const MAX_CANDIDATES = 20000;

export function planMumWeek(input: OptimiserInput): OptimiserResult {
  const { days, shiftOptions, requiredMinutes } = input;

  if (shiftOptions.length === 0) {
    return { best: null, alternatives: [], message: "Add at least one shift type for this person first." };
  }

  const lockedPaid = days.reduce((sum, d) => sum + (d.locked?.paidMinutes ?? 0), 0);
  const target = requiredMinutes - lockedPaid;
  const unlockedIndexes = days.map((d, i) => (d.locked ? -1 : i)).filter((i) => i >= 0);
  const maxOptionPaid = Math.max(...shiftOptions.map((o) => o.paidMinutes));

  // DFS over unlocked days, assigning OFF or one allowed shift type, pruning
  // branches that can't land within one shift of the target. Deterministic
  // order (days ascending, options in their given order) so results are stable.
  const candidates: (MumShiftOption | null)[][] = [];
  const base: (MumShiftOption | null)[] = days.map(() => null);

  function dfs(pos: number, running: number): void {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (pos === unlockedIndexes.length) {
      if (Math.abs(running - target) <= maxOptionPaid) candidates.push([...base]);
      return;
    }
    const remaining = unlockedIndexes.length - pos;
    // prune: even filling every remaining day with the biggest shift can't reach.
    if (running + remaining * maxOptionPaid < target - maxOptionPaid) return;
    // prune: already too far over.
    if (running > target + maxOptionPaid) return;

    const dayIndex = unlockedIndexes[pos];
    base[dayIndex] = null;
    dfs(pos + 1, running);
    for (const option of shiftOptions) {
      base[dayIndex] = option;
      dfs(pos + 1, running + option.paidMinutes);
    }
    base[dayIndex] = null;
  }
  dfs(0, 0);

  if (candidates.length === 0) {
    return {
      best: null,
      alternatives: [],
      message: "No combination of the available shift types gets close to the weekly hours. Try adding a shift type or adjusting the required hours.",
    };
  }

  const scored = candidates
    .map((chosen) => ({ chosen, plan: evaluate(input, chosen), key: [] as number[] }))
    .map((c) => ({ ...c, key: rankKey(c.plan, c.chosen, days) }))
    .sort((a, b) => compareKeys(a.key, b.key) || signature(a.chosen).localeCompare(signature(b.chosen)));

  const best = scored[0];
  const seen = new Set([signature(best.chosen)]);
  const alternatives: WeekPlan[] = [];
  const maxAlt = input.maxAlternatives ?? 3;
  for (const c of scored.slice(1)) {
    const sig = signature(c.chosen);
    if (seen.has(sig)) continue;
    // only offer an alternative that is genuinely different in shape.
    seen.add(sig);
    alternatives.push(c.plan);
    if (alternatives.length >= maxAlt) break;
  }

  return { best: best.plan, alternatives };
}
