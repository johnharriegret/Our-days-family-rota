import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { normaliseTermWeekdays } from "@/lib/termWeekdays";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id: schoolId } = await params;
    const school = await prisma.school.findFirst({
      where: { id: schoolId, householdId: session.householdId },
    });
    if (!school) return apiError("School not found", 404);

    type Block = {
      startDate?: string;
      endDate?: string;
      type?: "TERM" | "HOLIDAY" | "INSET" | "BANK_HOLIDAY";
      label?: string;
      weekdays?: number[];
    };
    const body = (await request.json()) as Block & { blocks?: Block[] };
    // Accept either a single block or { blocks: [...] } for a bulk import.
    const blocks: Block[] = Array.isArray(body.blocks) ? body.blocks : [body];
    if (blocks.length === 0) return apiError("No term blocks provided", 422);

    const data = [];
    for (const b of blocks) {
      if (!b.startDate || !b.endDate || !b.type || !b.label) {
        return apiError("Each block needs startDate, endDate, type and label", 422);
      }
      if (b.startDate > b.endDate) return apiError("startDate must be on or before endDate", 422);
      const weekdays = b.type === "TERM" ? normaliseTermWeekdays(b.weekdays) : [1, 2, 3, 4, 5];
      data.push({
        schoolId,
        startDate: new Date(b.startDate),
        endDate: new Date(b.endDate),
        type: b.type,
        label: b.label,
        weekdays,
      });
    }

    if (data.length === 1) {
      const term = await prisma.schoolTerm.create({ data: data[0] });
      return NextResponse.json({ term });
    }
    const result = await prisma.schoolTerm.createMany({ data });
    return NextResponse.json({ created: result.count });
  });
}
