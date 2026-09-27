import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const members = await prisma.familyMember.findMany({
      where: { householdId: session.householdId, archived: false },
      include: { school: true, user: { select: { id: true, email: true } } },
      orderBy: { kind: "asc" },
    });
    return NextResponse.json({
      members: members.map(({ user, ...m }) => ({ ...m, login: user ? { id: user.id, email: user.email } : null })),
    });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { name, kind, dateOfBirth, schoolId, colorToken, icon, requiredWeeklyMinutes } = body as {
      name?: string;
      kind?: "PARENT" | "CHILD";
      dateOfBirth?: string | null;
      schoolId?: string | null;
      colorToken?: string;
      icon?: string;
      requiredWeeklyMinutes?: number | null;
    };
    if (!name || !kind || !colorToken || !icon) {
      return apiError("name, kind, colorToken and icon are required", 422);
    }
    const member = await prisma.familyMember.create({
      data: {
        householdId: session.householdId,
        name,
        kind,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        schoolId: schoolId || null,
        colorToken,
        icon,
        requiredWeeklyMinutes: requiredWeeklyMinutes ?? null,
      },
    });
    return NextResponse.json({ member });
  });
}
