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
    const { name, dateOfBirth, schoolId, colorToken, icon, requiredWeeklyMinutes } = body as {
      name?: string;
      dateOfBirth?: string | null;
      schoolId?: string | null;
      colorToken?: string;
      icon?: string;
      requiredWeeklyMinutes?: number | null;
    };
    const member = await prisma.familyMember.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(schoolId !== undefined && { schoolId: schoolId || null }),
        ...(colorToken !== undefined && { colorToken }),
        ...(icon !== undefined && { icon }),
        ...(requiredWeeklyMinutes !== undefined && { requiredWeeklyMinutes }),
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
