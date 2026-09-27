import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const existing = await prisma.school.findFirst({ where: { id, householdId: session.householdId } });
    if (!existing) return apiError("Not found", 404);

    const body = await request.json();
    const { name, startLocal, endLocal } = body as { name?: string; startLocal?: string; endLocal?: string };
    const TIME_RE = /^\d{2}:\d{2}$/;
    if (startLocal !== undefined && !TIME_RE.test(startLocal)) return apiError("startLocal must be HH:MM", 422);
    if (endLocal !== undefined && !TIME_RE.test(endLocal)) return apiError("endLocal must be HH:MM", 422);

    const school = await prisma.school.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(startLocal !== undefined && { startLocal }),
        ...(endLocal !== undefined && { endLocal }),
      },
    });
    return NextResponse.json({ school });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const existing = await prisma.school.findFirst({ where: { id, householdId: session.householdId } });
    if (!existing) return apiError("Not found", 404);
    // Safe even if children are still linked to it: the schema's FK
    // (ON DELETE SET NULL) clears their schoolId automatically, and its
    // SchoolTerm rows cascade-delete with it.
    await prisma.school.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
