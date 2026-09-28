import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireSession();
    const { id } = await params;
    const event = await prisma.event.findFirst({ where: { id, householdId: session.householdId } });
    if (!event) return apiError("Not found", 404);
    const body = await request.json();
    const { title, memberIds, startLocal, endLocal, category } = body as {
      title?: string;
      memberIds?: string[];
      startLocal?: string | null;
      endLocal?: string | null;
      category?: "APPOINTMENT" | "ACTIVITY" | "HOLIDAY" | "OTHER";
    };
    if (title !== undefined && !title.trim()) return apiError("Title can't be empty", 422);

    const updated = await prisma.event.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(memberIds !== undefined && { memberIds }),
        ...(startLocal !== undefined && { startLocal: startLocal || null }),
        ...(endLocal !== undefined && { endLocal: endLocal || null }),
        ...(category !== undefined && { category }),
      },
    });
    return NextResponse.json({ event: updated });
  });
}

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
