import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const rule = await prisma.childcareRule.findFirst({
      where: { householdId: session.householdId },
      orderBy: { effectiveFrom: "desc" },
    });
    return NextResponse.json({ rule });
  });
}

// Rules are append-only: a new row supersedes the old one but the old one's
// history survives, so "what rule applied on that date" is always answerable.
export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { maxUnsupervisedMinutes, appliesWeekends, minSupervisorAge, strictPickupAge, pickupBufferMinutes } = body as {
      maxUnsupervisedMinutes?: number;
      appliesWeekends?: boolean;
      minSupervisorAge?: number | null;
      strictPickupAge?: number | null;
      pickupBufferMinutes?: number;
    };
    if (!maxUnsupervisedMinutes || maxUnsupervisedMinutes < 0) {
      return apiError("maxUnsupervisedMinutes must be a positive number", 422);
    }
    if (pickupBufferMinutes != null && pickupBufferMinutes < 0) {
      return apiError("pickupBufferMinutes must be a positive number", 422);
    }
    const rule = await prisma.childcareRule.create({
      data: {
        householdId: session.householdId,
        maxUnsupervisedMinutes,
        appliesWeekends: appliesWeekends ?? true,
        minSupervisorAge: minSupervisorAge ?? null,
        strictPickupAge: strictPickupAge ?? null,
        pickupBufferMinutes: pickupBufferMinutes ?? 30,
      },
    });
    return NextResponse.json({ rule });
  });
}
