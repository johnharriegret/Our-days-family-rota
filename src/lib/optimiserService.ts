import { prisma } from "./prisma";
import { addDays, isSchoolDay, planMumWeek, resolvePatternDay } from "./engine";
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
  weekStart: string;
  requiredMinutes: number | null;
};

/**
 * Gathers a household's real data for the week and runs the deterministic
 * shift optimiser (spec §6). Read-only: it returns recommendations, it never
 * writes shifts.
 */
export async function getMumWeekPlan(
  householdId: string,
  ownerId: string,
  weekStart: string,
): Promise<MumWeekPlan> {
  const owner = await prisma.familyMember.findFirst({
    where: { id: ownerId, householdId, kind: "PARENT" },
  });
  if (!owner) {
    return { best: null, alternatives: [], message: "That person isn't a parent in this household.", ownerId, ownerName: "", weekStart, requiredMinutes: null };
  }

  const weekEnd = addDays(weekStart, 6);
  const rangeStart = addDays(weekStart, -1); // one day back for overnight spill

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

  // Patterns (all versions) for anyone whose worked days we need to resolve.
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
      date: { gte: new Date(`${rangeStart}T00:00:00.000Z`), lte: new Date(`${weekEnd}T00:00:00.000Z`) },
    },
  });
  const shiftByKey = new Map(shifts.map((s) => [`${s.ownerId}|${toDateStr(s.date)}`, s]));

  // Resolve a parent's working interval for a date (manual shift wins, then rota).
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

  const minSupervisorAge = childcareRule?.minSupervisorAge ?? null;

  const optimiserDays: OptimiserDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);

    const other = otherParent ? workingInterval(otherParent.id, date) : { known: true, shift: null };

    const childInfo = children.map((c) => {
      const terms =
        c.school?.terms.map((t) => ({
          startDate: toDateStr(t.startDate),
          endDate: toDateStr(t.endDate),
          type: t.type,
          label: t.label,
          weekdays: t.weekdays,
        })) ?? [];
      const at = c.school ? isSchoolDay(date, terms) : false;
      return {
        at,
        start: c.school ? toMinutes(c.school.startLocal) : 0,
        end: c.school ? toMinutes(c.school.endLocal) : 0,
        dob: c.dateOfBirth ? toDateStr(c.dateOfBirth) : null,
      };
    });
    let schoolCover: DayInterval | null = null;
    if (childInfo.length > 0 && childInfo.every((c) => c.at)) {
      const start = Math.max(...childInfo.map((c) => c.start));
      const end = Math.min(...childInfo.map((c) => c.end));
      if (end > start) schoolCover = { startMinutes: start, endMinutes: end };
    }
    const supervisorHomeAllowance =
      minSupervisorAge != null &&
      childInfo.some((c) => !c.at && (ageOn(date, c.dob) ?? -1) >= minSupervisorAge);

    const ownShift = shiftByKey.get(`${ownerId}|${date}`);
    let locked: OptimiserDay["locked"] = null;
    if (ownShift?.locked) {
      const type = ownShift.shiftTypeId ? shiftTypeById.get(ownShift.shiftTypeId) : null;
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
      isWeekend: false, // engine derives the allowance from the real date
      hasChildren: children.length > 0,
      dadKnown: other.known,
      dadShift: other.shift,
      locked,
      schoolCover,
      supervisorHomeAllowance,
    });
  }

  const priorDadShift = otherParent ? workingInterval(otherParent.id, rangeStart).shift : null;
  const priorMumShift = workingInterval(ownerId, rangeStart).shift;

  if (owner.requiredWeeklyMinutes == null) {
    return {
      best: null,
      alternatives: [],
      message: `Set ${owner.name}'s weekly hours requirement in Settings first, so a plan can hit it exactly.`,
      ownerId,
      ownerName: owner.name,
      weekStart,
      requiredMinutes: null,
    };
  }

  const result = planMumWeek({
    days: optimiserDays,
    priorDadShift,
    priorMumShift,
    requiredMinutes: owner.requiredWeeklyMinutes,
    shiftOptions,
    rule: {
      maxUnsupervisedMinutes: childcareRule?.maxUnsupervisedMinutes ?? 180,
      appliesWeekends: childcareRule?.appliesWeekends ?? true,
    },
  });

  return { ...result, ownerId, ownerName: owner.name, weekStart, requiredMinutes: owner.requiredWeeklyMinutes };
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
