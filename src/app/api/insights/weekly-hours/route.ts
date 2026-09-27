import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { weekStart, weeklyHours } from "@/lib/engine";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId");
    const date = url.searchParams.get("date");
    if (!ownerId || !date) return apiError("ownerId and date are required", 422);

    const household = await prisma.household.findUnique({ where: { id: session.householdId } });
    const member = await prisma.familyMember.findFirst({
      where: { id: ownerId, householdId: session.householdId },
    });
    if (!member) return apiError("Family member not found", 404);
    if (!member.requiredWeeklyMinutes) {
      return NextResponse.json({ result: null });
    }

    const start = weekStart(date, household?.weekStartsOn ?? 1);
    const end = new Date(`${start}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 6);

    const shifts = await prisma.workShift.findMany({
      where: {
        ownerId,
        householdId: session.householdId,
        date: { gte: new Date(`${start}T00:00:00.000Z`), lte: end },
        paidMinutes: { not: null },
      },
    });

    const result = weeklyHours(
      start,
      shifts.map((s) => ({ date: s.date.toISOString().slice(0, 10), paidMinutes: s.paidMinutes ?? 0 })),
      member.requiredWeeklyMinutes,
    );
    return NextResponse.json({ result, weekStart: start });
  });
}
