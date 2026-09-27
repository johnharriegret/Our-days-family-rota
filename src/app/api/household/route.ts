import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const household = await prisma.household.findUnique({ where: { id: session.householdId } });
    return NextResponse.json({ household });
  });
}

export async function PATCH(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    const body = await request.json();
    const { weekStartsOn } = body as { weekStartsOn?: number };
    const household = await prisma.household.update({
      where: { id: session.householdId },
      data: { ...(weekStartsOn !== undefined && { weekStartsOn }) },
    });
    return NextResponse.json({ household });
  });
}
