import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireSession();
    const { id } = await params;
    const event = await prisma.event.findFirst({ where: { id, householdId: session.householdId } });
    if (!event) return apiError("Not found", 404);
    await prisma.event.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
