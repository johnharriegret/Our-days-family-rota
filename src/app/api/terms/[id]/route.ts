import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id } = await params;
    const term = await prisma.schoolTerm.findFirst({
      where: { id, school: { householdId: session.householdId } },
    });
    if (!term) return apiError("Not found", 404);
    await prisma.schoolTerm.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
