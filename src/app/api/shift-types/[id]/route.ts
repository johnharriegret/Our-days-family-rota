import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const existing = await prisma.shiftType.findFirst({ where: { id, householdId: session.householdId } });
    if (!existing) return apiError("Not found", 404);

    const body = await request.json();
    const { name, startLocal, endLocal, paidMinutes, color } = body as {
      name?: string;
      startLocal?: string;
      endLocal?: string;
      paidMinutes?: number;
      color?: string;
    };
    const type = await prisma.shiftType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(startLocal !== undefined && { startLocal }),
        ...(endLocal !== undefined && { endLocal }),
        ...(paidMinutes !== undefined && { paidMinutes }),
        ...(color !== undefined && { color }),
      },
    });
    return NextResponse.json({ type });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const existing = await prisma.shiftType.findFirst({ where: { id, householdId: session.householdId } });
    if (!existing) return apiError("Not found", 404);
    await prisma.shiftType.update({ where: { id }, data: { archived: true } });
    return NextResponse.json({ ok: true });
  });
}
