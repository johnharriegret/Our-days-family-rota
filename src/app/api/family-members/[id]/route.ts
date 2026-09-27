import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const existing = await prisma.familyMember.findFirst({
      where: { id, householdId: session.householdId },
    });
    if (!existing) return apiError("Not found", 404);

    const body = await request.json();
    const {
      name,
      dateOfBirth,
      schoolId,
      colorToken,
      icon,
      requiredWeeklyMinutes,
      dayColor,
      nightColor,
      dayStartLocal,
      dayEndLocal,
      nightStartLocal,
      nightEndLocal,
    } = body as {
      name?: string;
      dateOfBirth?: string | null;
      schoolId?: string | null;
      colorToken?: string;
      icon?: string;
      requiredWeeklyMinutes?: number | null;
      dayColor?: string | null;
      nightColor?: string | null;
      dayStartLocal?: string | null;
      dayEndLocal?: string | null;
      nightStartLocal?: string | null;
      nightEndLocal?: string | null;
    };
    const TIME_RE = /^\d{2}:\d{2}$/;
    const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
    for (const [label, value] of [
      ["dayStartLocal", dayStartLocal],
      ["dayEndLocal", dayEndLocal],
      ["nightStartLocal", nightStartLocal],
      ["nightEndLocal", nightEndLocal],
    ] as const) {
      if (value != null && !TIME_RE.test(value)) return apiError(`${label} must be HH:MM`, 422);
    }
    for (const [label, value] of [
      ["dayColor", dayColor],
      ["nightColor", nightColor],
    ] as const) {
      if (value != null && !HEX_RE.test(value)) return apiError(`${label} must be a hex colour`, 422);
    }

    const member = await prisma.familyMember.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(schoolId !== undefined && { schoolId: schoolId || null }),
        ...(colorToken !== undefined && { colorToken }),
        ...(icon !== undefined && { icon }),
        ...(requiredWeeklyMinutes !== undefined && { requiredWeeklyMinutes }),
        ...(dayColor !== undefined && { dayColor: dayColor || null }),
        ...(nightColor !== undefined && { nightColor: nightColor || null }),
        ...(dayStartLocal !== undefined && { dayStartLocal: dayStartLocal || null }),
        ...(dayEndLocal !== undefined && { dayEndLocal: dayEndLocal || null }),
        ...(nightStartLocal !== undefined && { nightStartLocal: nightStartLocal || null }),
        ...(nightEndLocal !== undefined && { nightEndLocal: nightEndLocal || null }),
      },
    });
    return NextResponse.json({ member });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const existing = await prisma.familyMember.findFirst({
      where: { id, householdId: session.householdId },
    });
    if (!existing) return apiError("Not found", 404);
    await prisma.familyMember.update({ where: { id }, data: { archived: true } });
    return NextResponse.json({ ok: true });
  });
}
