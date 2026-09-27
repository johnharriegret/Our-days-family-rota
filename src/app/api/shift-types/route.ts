import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const ownerId = new URL(request.url).searchParams.get("ownerId");
    const types = await prisma.shiftType.findMany({
      where: {
        householdId: session.householdId,
        archived: false,
        ...(ownerId && { ownerId }),
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ types });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { ownerId, name, startLocal, endLocal, paidMinutes, color } = body as {
      ownerId?: string;
      name?: string;
      startLocal?: string;
      endLocal?: string;
      paidMinutes?: number;
      color?: string;
    };
    if (!ownerId || !name || !startLocal || !endLocal || !paidMinutes || !color) {
      return apiError("ownerId, name, startLocal, endLocal, paidMinutes and color are required", 422);
    }
    const owner = await prisma.familyMember.findFirst({
      where: { id: ownerId, householdId: session.householdId },
    });
    if (!owner) return apiError("Family member not found", 404);

    const type = await prisma.shiftType.create({
      data: { householdId: session.householdId, ownerId, name, startLocal, endLocal, paidMinutes, color },
    });
    return NextResponse.json({ type });
  });
}
