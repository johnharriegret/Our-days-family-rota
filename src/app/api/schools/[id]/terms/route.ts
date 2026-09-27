import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { id: schoolId } = await params;
    const school = await prisma.school.findFirst({
      where: { id: schoolId, householdId: session.householdId },
    });
    if (!school) return apiError("School not found", 404);

    const body = await request.json();
    const { startDate, endDate, type, label } = body as {
      startDate?: string;
      endDate?: string;
      type?: "TERM" | "HOLIDAY" | "INSET" | "BANK_HOLIDAY";
      label?: string;
    };
    if (!startDate || !endDate || !type || !label) {
      return apiError("startDate, endDate, type and label are required", 422);
    }
    if (startDate > endDate) return apiError("startDate must be on or before endDate", 422);

    const term = await prisma.schoolTerm.create({
      data: { schoolId, startDate: new Date(startDate), endDate: new Date(endDate), type, label },
    });
    return NextResponse.json({ term });
  });
}
