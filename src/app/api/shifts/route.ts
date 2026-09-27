import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return apiError("from and to are required", 422);

    const shifts = await prisma.workShift.findMany({
      where: {
        householdId: session.householdId,
        ...(ownerId && { ownerId }),
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
      include: { shiftType: true },
      orderBy: { date: "asc" },
    });
    return NextResponse.json({ shifts });
  });
}

/** Upserts one day's manual shift/override for a member (unique on ownerId+date). */
export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const body = await request.json();
    const { ownerId, date, shiftTypeId, customStart, customEnd, paidMinutes, locked, note, source } =
      body as {
        ownerId?: string;
        date?: string;
        shiftTypeId?: string | null;
        customStart?: string | null;
        customEnd?: string | null;
        paidMinutes?: number | null;
        locked?: boolean;
        note?: string | null;
        source?: "MANUAL" | "PATTERN_OVERRIDE";
      };
    if (!ownerId || !date) return apiError("ownerId and date are required", 422);

    const owner = await prisma.familyMember.findFirst({
      where: { id: ownerId, householdId: session.householdId },
    });
    if (!owner) return apiError("Family member not found", 404);

    let resolvedPaidMinutes = paidMinutes ?? null;
    if (shiftTypeId) {
      const type = await prisma.shiftType.findFirst({
        where: { id: shiftTypeId, householdId: session.householdId },
      });
      if (!type) return apiError("Shift type not found", 404);
      resolvedPaidMinutes = type.paidMinutes;
    }

    const shift = await prisma.workShift.upsert({
      where: { ownerId_date: { ownerId, date: new Date(`${date}T00:00:00.000Z`) } },
      create: {
        householdId: session.householdId,
        ownerId,
        date: new Date(`${date}T00:00:00.000Z`),
        shiftTypeId: shiftTypeId || null,
        customStart: shiftTypeId ? null : customStart || null,
        customEnd: shiftTypeId ? null : customEnd || null,
        paidMinutes: resolvedPaidMinutes,
        locked: Boolean(locked),
        note: note || null,
        source: source ?? "MANUAL",
      },
      update: {
        shiftTypeId: shiftTypeId || null,
        customStart: shiftTypeId ? null : customStart || null,
        customEnd: shiftTypeId ? null : customEnd || null,
        paidMinutes: resolvedPaidMinutes,
        locked: Boolean(locked),
        note: note || null,
        source: source ?? "MANUAL",
      },
      include: { shiftType: true },
    });
    return NextResponse.json({ shift });
  });
}
