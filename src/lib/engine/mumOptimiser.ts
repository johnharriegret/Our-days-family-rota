import { evaluateTimeline, type AdultDay, type TimelineDay, type TimelineGap } from "./timeline";

// A deterministic, rules-based optimiser for one parent's variable week (spec
// §6, "Plan Mum's Week"). It never invents scheduling maths with AI: it
// enumerates real shift combinations that hit the hard weekly-hours
// requirement and ranks them by the household's priority order. It only
// RECOMMENDS - applying a plan is a separate, explicit step - and it never
// proposes a change to a day the user has locked.
//
// Two things about its shape matter:
//
// 1. It is given a WINDOW, not a week: a context day before and after the
//    seven days being planned. A shift on the Sunday being planned can run
//    into a Monday that belongs to the next week's card, where the other
//    parent may already be committed to a day shift and the children still
//    need taking to school. Without the trailing context day that conflict is
//    invisible, which is exactly the bug this shape exists to prevent. Weekly
//    cards are a display concept and appear nowhere in this file.
//
// 2. Childcare is a HARD constraint, not a ranking preference. A candidate
//    with any childcare conflict is removed before scoring, so no amount of
//    good score - perfect hours, maximum time off together - can ever promote
//    an unsafe plan. When nothing valid exists the optimiser says so, and
//    hands back the closest unsafe option separately, clearly labelled, rather
//    than quietly presenting it as the best fit.

export type ShiftInterval = { startLocal: string; endLocal: string };

export type MumShiftOption = {
  id: string;
  name: string;
  startLocal: string;
  endLocal: string;
  paidMinutes: number;
};

/**
 * One day of the planning window. The childcare-context fields come straight
 * from `buildTimelineDay`, so the planner and the live calendar are always
 * looking at an identically-built day.
 */
export type OptimiserDay = TimelineDay & {
  /** true once the other parent's status for this day is actually known. */
  dadKnown: boolean;
  /** the other parent's working interval, or null if they're home that day. */
  dadShift: ShiftInterval | null;
  /**
   * The planned parent's own ALREADY-KNOWN shift: what is really saved for a
   * context day, and what a locked day is fixed to. Ignored for a plannable,
   * unlocked day, whose shift is the thing being chosen.
   */
  ownKnown: boolean;
  ownShift: ShiftInterval | null;
  /** locked shift the optimiser must keep as-is; shift null = locked day off. */
  locked: { paidMinutes: number; shift: ShiftInterval | null; label?: string } | null;
};

export type OptimiserInput = {
  timeZone: string;
  /** the whole window in date order, including the context day either side. */
  days: OptimiserDay[];
  /** first index of `days` actually being planned. */
  reportFrom: number;
  /** last index of `days` actually being planned (inclusive). */
  reportTo: number;
  requiredMinutes: number;
  shiftOptions: MumShiftOption[];
  rule: { maxUnsupervisedMinutes: number; appliesWeekends: boolean };
  maxAlternatives?: number;
  /**
   * Overrides the hard ceiling on how many candidate combinations generation
   * will collect before it stops. Defaults to `MAX_CANDIDATES`. Exposed mainly
   * so a test can force truncation and prove the optimiser stops claiming "no
   * safe plan" once the search is no longer exhaustive.
   */
  maxCandidates?: number;
};

/**
 * A developer-facing record of what the search actually did, so "no safe plan"
 * is never an unexamined claim. It answers, for one plan request, exactly how
 * many combinations were generated, how each hard rule culled the space, how
 * many survivors were safe, and - crucially - whether the search was
 * exhaustive. When `exhaustive` is false the optimiser has NOT proved that no
 * safe plan exists; it has only failed to find one within the combinations it
 * had time to check.
 */
export type OptimiserDiagnostics = {
  /** combinations that passed every hard rule and were scored. */
  generated: number;
  /** fully-assigned combinations discarded for landing outside the weekly-hours band. */
  rejectedByHours: number;
  /** whole sub-trees pruned early as unable to reach, or already past, the hours target. */
  hoursPrunedBranches: number;
  /** individual shift placements skipped because minimum rest would be violated. */
  rejectedByRest: number;
  /** generated combinations removed because they left a childcare conflict. */
  rejectedByChildcare: number;
  /** generated combinations that were childcare-safe. */
  safe: number;
  /** true when generation stopped at the cap before the space was exhausted. */
  truncated: boolean;
  /** true only when every feasible combination was generated - the negation of `truncated`. */
  exhaustive: boolean;
  /** the winning safe combination's signature, or null when none was safe. */
  bestSignature: string | null;
  /** the ceiling generation stops at (see `maxCandidates`/`MAX_CANDIDATES`). */
  candidateCap: number;
};

export type PlanDay = {
  date: string;
  /** null = day off in this plan. */
  option: MumShiftOption | null;
  locked: boolean;
  /** display name for a locked day (e.g. "Long Day" or "Off"). */
  lockedLabel: string | null;
  /** true once the other parent's status for this day is actually known. */
  dadKnown: boolean;
  /** the other parent's own (already fixed, not being planned) shift that day. */
  dadShift: ShiftInterval | null;
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
  /**
   * Every childcare conflict this plan would cause, including one that starts
   * on the last planned day and runs into the morning after it. Always empty
   * on a plan offered as `best`; populated on `bestWithConflicts` so the real
   * reason can be shown rather than just a count.
   */
  conflicts: TimelineGap[];
};

export type OptimiserResult = {
  /** always childcare-safe; null when no safe plan exists. */
  best: WeekPlan | null;
  alternatives: WeekPlan[];
  /**
   * The closest plan when every possible combination causes a childcare
   * conflict. Never presented as valid - it exists so the app can explain what
   * is blocking instead of showing nothing, and so applying it anyway has to
   * be a deliberate, separate choice.
   */
  bestWithConflicts: WeekPlan | null;
  /** set when no safe plan could be produced, with a plain-English reason. */
  message?: string;
  /** what the search actually did - counts of every combination and why each was culled. */
  diagnostics: OptimiserDiagnostics;
};

/** Minutes as a friendly hour count, e.g. 750 -> 12.5. */
function hoursLabel(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function shiftOf(option: MumShiftOption | null): ShiftInterval | null {
  return option ? { startLocal: option.startLocal, endLocal: option.endLocal } : null;
}

function toMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A shift's end, in minutes past the midnight it STARTED on - crosses past
 * 1440 for an overnight shift (end <= start, same convention as intervals.ts). */
function shiftEndAbsolute(shift: ShiftInterval): number {
  const start = toMinutesOfDay(shift.startLocal);
  let end = toMinutesOfDay(shift.endLocal);
  if (end <= start) end += 1440;
  return end;
}

/**
 * Minutes of rest between the end of a shift worked the day before and the
 * start of a shift worked today - negative means they actually overlap.
 * Returns null when there is nothing to check (either day is off).
 */
function restMinutes(dayBefore: ShiftInterval | null, today: ShiftInterval | null): number | null {
  if (!dayBefore || !today) return null;
  const dayBeforeEnd = shiftEndAbsolute(dayBefore);
  const todayStart = 1440 + toMinutesOfDay(today.startLocal); // today's midnight is +1440 from the day before's
  return todayStart - dayBeforeEnd;
}

/**
 * Minimum rest the optimiser will ever leave between two shifts, in minutes.
 * 11 hours mirrors the UK Working Time Regulations' statutory daily rest
 * minimum - a real, physical constraint the optimiser must never violate, not
 * just something to rank lower. Without this it could (and did, in practice -
 * this is the fix for a real live-use bug) suggest a night shift immediately
 * followed by a long day shift the next morning, which even overlaps.
 */
export const MIN_REST_MINUTES = 11 * 60;

function evaluate(input: OptimiserInput, chosen: (MumShiftOption | null)[]): WeekPlan {
  const { days, rule, reportFrom, reportTo } = input;

  // The planned parent's whereabouts for every day of the window: a real saved
  // shift on a context day, the fixed shift on a locked day, and whatever this
  // candidate proposes on the rest.
  const ownDays: AdultDay[] = days.map((day, i) => {
    const plannable = i >= reportFrom && i <= reportTo;
    if (!plannable) return { known: day.ownKnown, shift: day.ownShift };
    if (day.locked) return { known: true, shift: day.locked.shift };
    return { known: true, shift: shiftOf(chosen[i]) };
  });
  const dadDays: AdultDay[] = days.map((day) => ({ known: day.dadKnown, shift: day.dadShift }));

  const timeline = evaluateTimeline({
    timeZone: input.timeZone,
    days,
    adults: [dadDays, ownDays],
    rule,
    reportFrom,
    reportTo,
  });

  let totalPaid = 0;
  let handovers = 0;
  let bothWorking = 0;
  let familyDays = 0;
  let coupleDaytime = 0;

  const planDays: PlanDay[] = [];
  for (let i = reportFrom; i <= reportTo; i++) {
    const day = days[i];
    const locked = day.locked;
    const option = locked ? null : chosen[i];
    // paid minutes: a locked day contributes its own paid total.
    totalPaid += locked ? locked.paidMinutes : option?.paidMinutes ?? 0;

    const verdict = timeline.byDate[day.date];
    if (verdict?.status === "HANDOVER") handovers += 1;

    const ownWorking = Boolean(ownDays[i].shift);
    const dadWorking = Boolean(day.dadShift);
    if (ownWorking && dadWorking) bothWorking += 1;
    if (!ownWorking && !dadWorking && day.dadKnown) {
      familyDays += 1;
      // Both parents off AND the children at school = daytime the couple gets
      // to themselves. This is the outcome the household most wants, so it is
      // tracked and rewarded separately from an ordinary shared day off.
      if (day.schoolCover) coupleDaytime += 1;
    }

    planDays.push({
      date: day.date,
      option: locked ? null : option,
      locked: Boolean(locked),
      lockedLabel: locked ? locked.label ?? (locked.shift ? "Shift" : "Off") : null,
      dadKnown: day.dadKnown,
      dadShift: day.dadShift,
    });
  }

  return {
    days: planDays,
    conflicts: timeline.conflicts,
    metrics: {
      totalPaidMinutes: totalPaid,
      requiredMinutes: input.requiredMinutes,
      hoursExact: totalPaid === input.requiredMinutes,
      childcareConflicts: timeline.conflicts.length,
      handoverDays: handovers,
      bothParentsWorkingDays: bothWorking,
      familyDaysTogether: familyDays,
      coupleDaytimeOff: coupleDaytime,
    },
  };
}

/** Number of separate runs of consecutive working days (lower = less fragmented). */
function workingRuns(
  chosen: (MumShiftOption | null)[],
  days: OptimiserDay[],
  reportFrom: number,
  reportTo: number,
): number {
  let runs = 0;
  let prevWorking = false;
  for (let i = reportFrom; i <= reportTo; i++) {
    const locked = days[i].locked;
    const working = locked ? Boolean(locked.shift) : Boolean(chosen[i]);
    if (working && !prevWorking) runs += 1;
    prevWorking = working;
  }
  return runs;
}

/**
 * Lexicographic ranking key (lower is better), applied only to candidates that
 * have already passed every hard constraint. The household's overriding goal
 * is more time off TOGETHER, so the ranking actively MAXIMISES shared time off
 * rather than minimising both-working:
 *   1. exact weekly hours
 *   2. most couple-daytime-off days (both parents off while the kids are at
 *      school) - the premium outcome the family is optimising for
 *   3. most shared days off overall (family time together)
 *   4. fewest handover days
 *   5. least fragmented working week
 * Childcare conflicts are absent from this list on purpose: they are a hard
 * constraint, filtered out before ranking, never a score something else can
 * outweigh. Both-parents-working days are deliberately not penalised either: a
 * day both work while the children are safely at school actually PROTECTS a
 * shared day off elsewhere.
 */
function rankKey(
  plan: WeekPlan,
  chosen: (MumShiftOption | null)[],
  days: OptimiserDay[],
  reportFrom: number,
  reportTo: number,
): number[] {
  const m = plan.metrics;
  return [
    Math.abs(m.totalPaidMinutes - m.requiredMinutes),
    -m.coupleDaytimeOff,
    -m.familyDaysTogether,
    m.handoverDays,
    workingRuns(chosen, days, reportFrom, reportTo),
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

export const MAX_CANDIDATES = 20000;

export function planMumWeek(input: OptimiserInput): OptimiserResult {
  const { days, shiftOptions, requiredMinutes, reportFrom, reportTo } = input;
  const cap = input.maxCandidates ?? MAX_CANDIDATES;

  if (shiftOptions.length === 0) {
    return {
      best: null,
      alternatives: [],
      bestWithConflicts: null,
      message: "Add at least one shift type for this person first.",
      diagnostics: {
        generated: 0,
        rejectedByHours: 0,
        hoursPrunedBranches: 0,
        rejectedByRest: 0,
        rejectedByChildcare: 0,
        safe: 0,
        truncated: false,
        exhaustive: true,
        bestSignature: null,
        candidateCap: cap,
      },
    };
  }

  const planned = days.slice(reportFrom, reportTo + 1);
  const lockedPaid = planned.reduce((sum, d) => sum + (d.locked?.paidMinutes ?? 0), 0);
  const target = requiredMinutes - lockedPaid;
  const unlockedIndexes: number[] = [];
  for (let i = reportFrom; i <= reportTo; i++) {
    if (!days[i].locked) unlockedIndexes.push(i);
  }
  const maxOptionPaid = Math.max(...shiftOptions.map((o) => o.paidMinutes));

  // DFS over unlocked days, assigning OFF or one allowed shift type, pruning
  // branches that cannot land within one shift of the target. Deterministic
  // order (days ascending, options in their given order) so results are stable.
  const candidates: (MumShiftOption | null)[][] = [];
  const base: (MumShiftOption | null)[] = days.map(() => null);

  // Search diagnostics: every combination the DFS considers is accounted for,
  // so the caller can prove afterwards whether the space was exhausted (and
  // therefore whether "no safe plan" is a fact or just "none found in time").
  let truncated = false;
  let rejectedByHours = 0; // fully-assigned combos outside the hours band
  let hoursPrunedBranches = 0; // sub-trees pruned before reaching a leaf
  let rejectedByRest = 0; // shift placements skipped for minimum rest

  /** The shift actually on a given day: locked, already-known, or chosen so far. */
  function actualShiftAt(dayIndex: number): ShiftInterval | null {
    if (dayIndex < 0 || dayIndex >= days.length) return null;
    const day = days[dayIndex];
    if (dayIndex < reportFrom || dayIndex > reportTo) return day.ownShift;
    return day.locked ? day.locked.shift : shiftOf(base[dayIndex]);
  }

  function dfs(pos: number, running: number): void {
    // The cap is a safety ceiling, not a design feature: hitting it means the
    // search is no longer exhaustive, which the result must own up to rather
    // than silently presenting a partial search as if it were complete.
    if (candidates.length >= cap) {
      truncated = true;
      return;
    }
    if (pos === unlockedIndexes.length) {
      if (Math.abs(running - target) <= maxOptionPaid) candidates.push([...base]);
      else rejectedByHours += 1;
      return;
    }
    const remaining = unlockedIndexes.length - pos;
    // prune: even filling every remaining day with the biggest shift can't reach.
    if (running + remaining * maxOptionPaid < target - maxOptionPaid) {
      hoursPrunedBranches += 1;
      return;
    }
    // prune: already too far over.
    if (running > target + maxOptionPaid) {
      hoursPrunedBranches += 1;
      return;
    }

    const dayIndex = unlockedIndexes[pos];
    const dayBeforeShift = actualShiftAt(dayIndex - 1);
    // The day after is only a fixed quantity when it is not itself a DFS step:
    // a locked day, or the context day beyond the planned week.
    const nextIndex = dayIndex + 1;
    const nextFixedShift =
      nextIndex < days.length && (nextIndex > reportTo || days[nextIndex].locked)
        ? actualShiftAt(nextIndex)
        : null;

    base[dayIndex] = null;
    dfs(pos + 1, running);
    for (const option of shiftOptions) {
      const todayShift = shiftOf(option);
      // Hard constraint, never just ranked lower: physically impossible rest
      // (e.g. a night shift straight into the next morning's long day) is never
      // offered at all, whether the clash is with the day before or the day
      // after.
      const restBefore = restMinutes(dayBeforeShift, todayShift);
      if (restBefore !== null && restBefore < MIN_REST_MINUTES) {
        rejectedByRest += 1;
        continue;
      }
      const restAfter = restMinutes(todayShift, nextFixedShift);
      if (restAfter !== null && restAfter < MIN_REST_MINUTES) {
        rejectedByRest += 1;
        continue;
      }

      base[dayIndex] = option;
      dfs(pos + 1, running + option.paidMinutes);
    }
    base[dayIndex] = null;
  }
  dfs(0, 0);

  /** Assembles the diagnostics record once the safe count is known. */
  const makeDiagnostics = (safeCount: number, bestSignature: string | null): OptimiserDiagnostics => ({
    generated: candidates.length,
    rejectedByHours,
    hoursPrunedBranches,
    rejectedByRest,
    rejectedByChildcare: candidates.length - safeCount,
    safe: safeCount,
    truncated,
    exhaustive: !truncated,
    bestSignature,
    candidateCap: cap,
  });

  if (candidates.length === 0) {
    return {
      best: null,
      alternatives: [],
      bestWithConflicts: null,
      // A truncated search that produced nothing is not the same as "the hours
      // are impossible" - the space simply wasn't finished. Don't conflate them.
      message: truncated
        ? "The search hit its size limit before it could assemble any workable combination, so this is not proof that none exists. Try fewer shift types, locking a day, or adjusting the hours."
        : "No combination of the available shift types gets close to the weekly hours. Try adding a shift type or adjusting the required hours.",
      diagnostics: makeDiagnostics(0, null),
    };
  }

  const scored = candidates
    .map((chosen) => {
      const plan = evaluate(input, chosen);
      return { chosen, plan, key: rankKey(plan, chosen, days, reportFrom, reportTo) };
    })
    .sort((a, b) => compareKeys(a.key, b.key) || signature(a.chosen).localeCompare(signature(b.chosen)));

  // Hard constraint: a plan that leaves the children without cover is not a
  // plan. Filtered out before anything is ranked or offered.
  const safe = scored.filter((c) => c.plan.metrics.childcareConflicts === 0);

  if (safe.length === 0) {
    const closest = scored[0];
    const worst = closest.plan.conflicts[0];
    // "Every option leaves a gap" is only true if every option was actually
    // checked. A truncated search has NOT proved that - it must say so instead
    // of asserting a fact it didn't establish (brief §10).
    const message = truncated
      ? `Checked ${candidates.length} combinations and none was safe, but the search reached its size limit before every combination could be checked - so this does not prove no safe plan exists. Try fewer shift types, locking a day, or adjusting the hours.`
      : worst
        ? `Every option leaves a childcare gap, so there is no safe plan for this week. The closest option still has a problem: ${worst.explanation}`
        : "Every option leaves a childcare gap, so there is no safe plan for this week.";
    return {
      best: null,
      alternatives: [],
      bestWithConflicts: closest.plan,
      message,
      diagnostics: makeDiagnostics(0, null),
    };
  }

  const best = safe[0];
  const diagnostics = makeDiagnostics(safe.length, signature(best.chosen));
  const seen = new Set([signature(best.chosen)]);
  const alternatives: WeekPlan[] = [];
  const maxAlt = input.maxAlternatives ?? 3;
  for (const c of safe.slice(1)) {
    const sig = signature(c.chosen);
    if (seen.has(sig)) continue;
    // only offer an alternative that is genuinely different in shape.
    seen.add(sig);
    alternatives.push(c.plan);
    if (alternatives.length >= maxAlt) break;
  }

  // A safe plan exists, but sometimes the only way to hit the contracted hours
  // is to accept a childcare gap - a week where every shift long enough to
  // reach the hours leaves the school run uncovered, so the safest plan is to
  // work very little. Saying only "here is a safe plan for 0 of your 12.5
  // hours" would be true and useless. The trade-off is named instead, with the
  // exact-hours option offered separately and never as the recommendation.
  const hoursDelta = (plan: WeekPlan) =>
    Math.abs(plan.metrics.totalPaidMinutes - plan.metrics.requiredMinutes);
  const closestUnsafe = scored.find((c) => c.plan.metrics.childcareConflicts > 0) ?? null;
  const unsafeGetsCloserToTheHours =
    closestUnsafe !== null && hoursDelta(closestUnsafe.plan) < hoursDelta(best.plan);

  if (unsafeGetsCloserToTheHours && closestUnsafe) {
    const shortBy = hoursLabel(hoursDelta(best.plan));
    return {
      best: best.plan,
      alternatives,
      bestWithConflicts: closestUnsafe.plan,
      message: `There's no way to work these hours this week without a childcare gap. The safe plan below is ${shortBy} hours off the target; the option after it reaches the hours but leaves a gap: ${
        closestUnsafe.plan.conflicts[0]?.explanation ?? "nobody is available for part of the week."
      }`,
      diagnostics,
    };
  }

  return { best: best.plan, alternatives, bestWithConflicts: null, diagnostics };
}
