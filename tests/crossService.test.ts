import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { /* no database means skip */ }
}

const hasDatabase = Boolean(process.env.POSTGRES_URL);

test("a blank shift-type-only parent is known off to both planner and calendar", { skip: !hasDatabase }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { getMumWeekPlan } = await import("../src/lib/optimiserService.ts");
  const { getCalendarRange } = await import("../src/lib/calendarService.ts");
  const household = await prisma.household.create({ data: { timezone: "Europe/London" } });

  try {
    const school = await prisma.school.create({
      data: {
        householdId: household.id, name: "Cross-service school", startLocal: "08:45", endLocal: "15:15",
        terms: { create: { startDate: new Date("2026-09-07"), endDate: new Date("2026-10-23"), type: "TERM", label: "Autumn", weekdays: [1, 2, 3, 4, 5] } },
      },
    });
    const other = await prisma.familyMember.create({ data: { householdId: household.id, name: "Other", kind: "PARENT", colorToken: "blue", icon: "user" } });
    const owner = await prisma.familyMember.create({ data: { householdId: household.id, name: "Planner", kind: "PARENT", colorToken: "pink", icon: "user", requiredWeeklyMinutes: 750 } });
    await prisma.familyMember.create({ data: { householdId: household.id, name: "Child", kind: "CHILD", colorToken: "green", icon: "user", dateOfBirth: new Date("2023-01-01"), schoolId: school.id } });
    await prisma.childcareRule.create({ data: { householdId: household.id, maxUnsupervisedMinutes: 180, appliesWeekends: true, pickupBufferMinutes: 30, schoolRunMorningFromLocal: "06:00" } });

    // Other has a shift type but no pattern and no work-shift row for Monday:
    // that blank day is a known OFF day, not an unjudgeable unknown.
    await prisma.shiftType.create({ data: { householdId: household.id, ownerId: other.id, name: "Other day", startLocal: "06:00", endLocal: "18:00", paidMinutes: 720, color: "#00f" } });
    const longDay = await prisma.shiftType.create({ data: { householdId: household.id, ownerId: owner.id, name: "Long", startLocal: "07:00", endLocal: "20:00", paidMinutes: 750, color: "#f0a" } });
    await prisma.workShift.create({ data: { householdId: household.id, ownerId: owner.id, date: new Date("2026-09-21"), shiftTypeId: longDay.id, paidMinutes: 750, source: "MANUAL", locked: true } });

    const plan = await getMumWeekPlan(household.id, owner.id, "2026-09-21");
    const plannerReportsConflict = Boolean(plan.bestWithConflicts?.conflicts.some((gap) => gap.startDate === "2026-09-21"));
    const calendar = await getCalendarRange(household.id, "2026-09-21", "2026-09-21");
    const calendarReportsConflict = calendar[0].childcare?.status === "CHILDCARE_NEEDED";

    assert.equal(calendar[0].members.find((m) => m.memberId === other.id)?.label, "Off");
    assert.equal(plannerReportsConflict, calendarReportsConflict, "planner and calendar must agree on the childcare verdict");
    assert.equal(plannerReportsConflict, true, "the known-off parent cannot hide the locked long-day conflict");
  } finally {
    await prisma.household.delete({ where: { id: household.id } });
    await prisma.$disconnect();
  }
});
