import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, withApi } from "@/lib/api";
import { requireRole } from "@/lib/session";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Clears one parent's editable saved shifts for a calendar month. Repeating
 * patterns and locked rows are deliberately left alone. */
export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { ownerId, from, to } = await request.json() as { ownerId?: string; from?: string; to?: string };
    if (!ownerId || !from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
      return apiError("ownerId and a valid from/to date range are required", 422);
    }
    const owner = await prisma.familyMember.findFirst({ where: { id: ownerId, householdId: session.householdId, kind: "PARENT" } });
    if (!owner) return apiError("Parent not found", 404);
    const result = await prisma.workShift.deleteMany({
      where: {
        householdId: session.householdId,
        ownerId,
        locked: false,
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
    });
    return NextResponse.json({ cleared: result.count });
  });
}
