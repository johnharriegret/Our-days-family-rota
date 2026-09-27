import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const schools = await prisma.school.findMany({
      where: { householdId: session.householdId },
      include: { terms: { orderBy: { startDate: "asc" } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ schools });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { name, startLocal, endLocal } = body as {
      name?: string;
      startLocal?: string;
      endLocal?: string;
    };
    if (!name) return apiError("name is required", 422);
    const school = await prisma.school.create({
      data: {
        householdId: session.householdId,
        name,
        startLocal: startLocal || "08:45",
        endLocal: endLocal || "15:15",
      },
    });
    return NextResponse.json({ school });
  });
}
