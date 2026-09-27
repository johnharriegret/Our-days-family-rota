import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

/**
 * The one test that goes all the way through the database: generate a plan,
 * apply it, read it back, and check that what was validated is what got saved
 * and what the calendar then shows.
 *
 * Everything else in this suite is pure-function. This one exists because the
 * gap between "the plan the planner checked" and "the shifts that ended up in
 * the database" is exactly the sort of seam a unit test cannot see across.
 *
 * It needs a real Postgres. With no database configured it skips rather than
 * fails, so `npm test` stays useful on a machine that hasn't set one up - but
 * anyone changing the planner should run it with one.
 */

// Pick up a local .env if there is one; `npm test` doesn't load it by itself.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // an unreadable .env just means we skip below
  }
}

const hasDatabase = Boolean(process.env.POSTGRES_URL);

const SUITE_TAG = "rota-apply-roundtrip-test";

test("a plan is applied exactly as it was validated, and the calendar agrees", { skip: !hasDatabase }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { getMumWeekPlan, applyMumWeekPlan } = await import("../src/lib/optimiserService.ts");
  const { getCalendarRange } = await import("../src/lib/calendarService.ts");

  // A household of its own, torn down at the end - never anyone's real data.
  const household = await prisma.household.create({
    data: { timezone: "Europe/London", weekStartsOn: 1 },
  });

  try {
    const school = await prisma.school.create({
      data: {
        householdId: household.id,
        name: `${SUITE_TAG} school`,
        startLocal: "08:45",
        endLocal: "15:15",
        terms: {
          create: [
            {
              startDate: new Date("2026-09-07T00:00:00.000Z"),
              endDate: new Date("2026-10-23T00:00:00.000Z"),
              type: "TERM",
              label: "Autumn 1",
              weekdays: [1, 2, 3, 4, 5],
            },
          ],
        },
      },
    });

    const dad = await prisma.familyMember.create({
      data: { householdId: household.id, name: "Dad", kind: "PARENT", colorToken: "orange", icon: "user" },
    });
    const mum = await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name: "Mum",
        kind: "PARENT",
        colorToken: "pink",
        icon: "user",
        requiredWeeklyMinutes: 720, // 12 hours
      },
    });
    await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name: "Teen",
        kind: "CHILD",
        colorToken: "blue",
        icon: "user",
        dateOfBirth: new Date("2013-01-05T00:00:00.000Z"),
        schoolId: school.id,
      },
    });
    await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name: "Toddler",
        kind: "CHILD",
        colorToken: "green",
        icon: "user",
        dateOfBirth: new Date("2023-01-05T00:00:00.000Z"),
        schoolId: school.id,
      },
    });

    await prisma.childcareRule.create({
      data: {
        householdId: household.id,
        maxUnsupervisedMinutes: 180,
        appliesWeekends: true,
        minSupervisorAge: 13,
        strictPickupAge: 5,
        pickupBufferMinutes: 30,
        schoolRunMorningFromLocal: "06:00",
      },
    });

    // Mum works one-tap shifts; one of them sits inside school hours.
    await prisma.shiftType.create({
      data: {
        householdId: household.id,
        ownerId: mum.id,
        name: "9-4",
        startLocal: "09:00",
        endLocal: "15:00",
        paidMinutes: 360,
        color: "#f0a",
      },
    });
    await prisma.shiftType.create({
      data: {
        householdId: household.id,
        ownerId: mum.id,
        name: "Long Day",
        startLocal: "07:00",
        endLocal: "20:00",
        paidMinutes: 750,
        color: "#0af",
      },
    });

    // Dad is on days Monday to Wednesday of the week being planned.
    const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
    for (const date of week.slice(0, 3)) {
      await prisma.workShift.create({
        data: {
          householdId: household.id,
          ownerId: dad.id,
          date: new Date(`${date}T00:00:00.000Z`),
          customStart: "06:00",
          customEnd: "18:00",
          paidMinutes: 720,
          source: "MANUAL",
        },
      });
    }
    // ...and explicitly off the rest of it, so his status is known, not guessed.
    for (const date of week.slice(3)) {
      await prisma.workShift.create({
        data: {
          householdId: household.id,
          ownerId: dad.id,
          date: new Date(`${date}T00:00:00.000Z`),
          source: "MANUAL",
        },
      });
    }

    const plan = await getMumWeekPlan(household.id, mum.id, week[0]);
    assert.ok(plan.best, `a safe plan should exist: ${plan.message ?? ""}`);
    assert.equal(plan.best.metrics.childcareConflicts, 0);

    const assignments = plan.best.days
      .filter((d) => !d.locked)
      .map((d) => ({ date: d.date, shiftTypeId: d.option?.id ?? null }));

    const applied = await applyMumWeekPlan(household.id, mum.id, assignments);
    assert.equal(applied.blocked, undefined, "a validated plan must not be refused");
    assert.equal(applied.applied, assignments.length);

    // Read the saved rows back and compare against what was validated.
    const saved = await prisma.workShift.findMany({
      where: { ownerId: mum.id },
      orderBy: { date: "asc" },
    });
    assert.equal(saved.length, assignments.length, "every planned day was written exactly once");
    for (const a of assignments) {
      const row = saved.find((s) => s.date.toISOString().slice(0, 10) === a.date);
      assert.ok(row, `a row exists for ${a.date}`);
      assert.equal(row.shiftTypeId, a.shiftTypeId, `${a.date} kept the shift type it was validated with`);
      assert.equal(row.customStart, null, "an applied plan never leaves a stale custom time behind");
      assert.equal(row.customEnd, null);
    }

    // The calendar - a completely separate read path - must agree that the
    // applied week is safe. This is the check that the planner and the calendar
    // are using the same rules on the same data.
    const calendar = await getCalendarRange(household.id, week[0], week[6]);
    assert.equal(calendar.length, 7);
    const conflictDays = calendar.filter((d) => d.childcare?.status === "CHILDCARE_NEEDED");
    assert.deepEqual(
      conflictDays.map((d) => d.date),
      [],
      "the calendar sees no conflict in a week the planner called safe",
    );
    // ...and it shows the shifts the plan chose.
    for (const a of assignments.filter((x) => x.shiftTypeId)) {
      const day = calendar.find((d) => d.date === a.date);
      const mumRow = day?.members.find((m) => m.memberId === mum.id);
      assert.equal(mumRow?.startLocal, "09:00", `${a.date} shows the applied shift`);
      assert.equal(mumRow?.endLocal, "15:00");
    }

    // Now the other direction: a set of assignments that WOULD leave the school
    // run uncovered has to be refused, not quietly written.
    const longDay = await prisma.shiftType.findFirstOrThrow({ where: { ownerId: mum.id, name: "Long Day" } });
    const before = await prisma.workShift.findMany({ where: { ownerId: mum.id }, orderBy: { date: "asc" } });

    const unsafe = await applyMumWeekPlan(household.id, mum.id, [{ date: week[0], shiftTypeId: longDay.id }]);
    assert.ok(unsafe.blocked, "an unsafe set of assignments must be refused");
    assert.equal(unsafe.applied, 0);
    assert.ok(unsafe.blocked.conflicts.length > 0, "and it must say what the problem is");

    // The refused attempt wrote nothing at all - not a partial week, not a row.
    const afterRefusal = await prisma.workShift.findMany({ where: { ownerId: mum.id }, orderBy: { date: "asc" } });
    assert.deepEqual(
      afterRefusal.map((r) => [r.date.toISOString().slice(0, 10), r.shiftTypeId, r.customStart]),
      before.map((r) => [r.date.toISOString().slice(0, 10), r.shiftTypeId, r.customStart]),
      "a refused apply leaves the saved week exactly as it was",
    );

    // The same unsafe set goes through only when explicitly allowed.
    const forced = await applyMumWeekPlan(
      household.id,
      mum.id,
      [{ date: week[0], shiftTypeId: longDay.id }],
      { allowConflicts: true },
    );
    assert.equal(forced.blocked, undefined);
    assert.equal(forced.applied, 1);
    const forcedRow = await prisma.workShift.findFirstOrThrow({
      where: { ownerId: mum.id, date: new Date(`${week[0]}T00:00:00.000Z`) },
    });
    assert.equal(forcedRow.shiftTypeId, longDay.id, "the deliberate override really is saved");
  } finally {
    await prisma.household.delete({ where: { id: household.id } });
    await prisma.$disconnect();
  }
});

test("the other parent's own shift types are resolved, not read as a day off", { skip: !hasDatabase }, async () => {
  // Found by the CodeRabbit audit. The planner used to resolve a saved shift
  // against only the PLANNED parent's own active shift types. Anything else -
  // the other parent's own shift type, or an archived one - fell through to
  // "no times", which the engine reads as a day off. The planner then believed
  // somebody was at home when they were at work, and missed the conflict. The
  // calendar resolved the same row correctly, so the two disagreed.
  const { prisma } = await import("../src/lib/prisma.ts");
  const { getMumWeekPlan } = await import("../src/lib/optimiserService.ts");

  const household = await prisma.household.create({ data: { timezone: "Europe/London" } });
  try {
    const school = await prisma.school.create({
      data: {
        householdId: household.id,
        name: `${SUITE_TAG} school 2`,
        startLocal: "08:45",
        endLocal: "15:15",
        terms: {
          create: [
            {
              startDate: new Date("2026-09-07T00:00:00.000Z"),
              endDate: new Date("2026-10-23T00:00:00.000Z"),
              type: "TERM",
              label: "Autumn 1",
              weekdays: [1, 2, 3, 4, 5],
            },
          ],
        },
      },
    });
    const dad = await prisma.familyMember.create({
      data: { householdId: household.id, name: "Dad", kind: "PARENT", colorToken: "orange", icon: "user" },
    });
    const mum = await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name: "Mum",
        kind: "PARENT",
        colorToken: "pink",
        icon: "user",
        requiredWeeklyMinutes: 750,
      },
    });
    for (const [name, dob] of [["Teen", "2013-01-05"], ["Toddler", "2023-01-05"]] as const) {
      await prisma.familyMember.create({
        data: {
          householdId: household.id,
          name,
          kind: "CHILD",
          colorToken: "blue",
          icon: "user",
          dateOfBirth: new Date(`${dob}T00:00:00.000Z`),
          schoolId: school.id,
        },
      });
    }
    await prisma.childcareRule.create({
      data: {
        householdId: household.id,
        maxUnsupervisedMinutes: 180,
        appliesWeekends: true,
        minSupervisorAge: 13,
        pickupBufferMinutes: 30,
        schoolRunMorningFromLocal: "06:00",
      },
    });

    // Dad's OWN shift type, and a saved week of it. Mum only has a Long Day,
    // which cannot coexist with his day shift without leaving the school run
    // uncovered - so the planner must find no safe plan.
    const dadDay = await prisma.shiftType.create({
      data: {
        householdId: household.id,
        ownerId: dad.id,
        name: "Dad Day",
        startLocal: "06:00",
        endLocal: "18:00",
        paidMinutes: 720,
        color: "#fa0",
      },
    });
    await prisma.shiftType.create({
      data: {
        householdId: household.id,
        ownerId: mum.id,
        name: "Long Day",
        startLocal: "07:00",
        endLocal: "20:00",
        paidMinutes: 750,
        color: "#0af",
      },
    });

    const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
    for (const date of [...week, "2026-09-20", "2026-09-28"]) {
      await prisma.workShift.create({
        data: {
          householdId: household.id,
          ownerId: dad.id,
          date: new Date(`${date}T00:00:00.000Z`),
          shiftTypeId: dadDay.id,
          paidMinutes: 720,
          source: "MANUAL",
        },
      });
    }

    const plan = await getMumWeekPlan(household.id, mum.id, week[0]);
    const seenAsWorking = (plan.best ?? plan.bestWithConflicts)?.days.filter((d) => d.dadShift) ?? [];
    assert.equal(seenAsWorking.length, 7, "every one of his saved day shifts must be visible to the planner");
    assert.deepEqual(seenAsWorking[0].dadShift, { startLocal: "06:00", endLocal: "18:00" }, "with its real hours");

    // And because he is on days all week, the only way to reach her hours is a
    // Long Day that leaves the school run uncovered - so the exact-hours option
    // must come back flagged rather than recommended.
    assert.ok(plan.bestWithConflicts, "the clash must be reported");
    assert.ok(plan.bestWithConflicts.conflicts.length > 0);
    assert.equal(plan.best?.metrics.childcareConflicts ?? 0, 0, "anything recommended is still safe");
  } finally {
    await prisma.household.delete({ where: { id: household.id } });
    await prisma.$disconnect();
  }
});

test("a locked day is never overwritten by applying a plan", { skip: !hasDatabase }, async () => {
  const { prisma } = await import("../src/lib/prisma.ts");
  const { applyMumWeekPlan } = await import("../src/lib/optimiserService.ts");

  const household = await prisma.household.create({ data: { timezone: "Europe/London" } });
  try {
    const mum = await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name: "Mum",
        kind: "PARENT",
        colorToken: "pink",
        icon: "user",
        requiredWeeklyMinutes: 720,
      },
    });
    const type = await prisma.shiftType.create({
      data: {
        householdId: household.id,
        ownerId: mum.id,
        name: "9-4",
        startLocal: "09:00",
        endLocal: "15:00",
        paidMinutes: 360,
        color: "#f0a",
      },
    });
    const lockedDate = "2026-09-21";
    await prisma.workShift.create({
      data: {
        householdId: household.id,
        ownerId: mum.id,
        date: new Date(`${lockedDate}T00:00:00.000Z`),
        customStart: "12:00",
        customEnd: "18:00",
        paidMinutes: 360,
        source: "MANUAL",
        locked: true,
      },
    });

    const result = await applyMumWeekPlan(household.id, mum.id, [{ date: lockedDate, shiftTypeId: type.id }]);
    assert.equal(result.applied, 0, "the locked day is skipped");
    const row = await prisma.workShift.findFirst({ where: { ownerId: mum.id } });
    assert.equal(row?.customStart, "12:00", "and its own times are untouched");
    assert.equal(row?.shiftTypeId, null);
  } finally {
    await prisma.household.delete({ where: { id: household.id } });
    await prisma.$disconnect();
  }
});
