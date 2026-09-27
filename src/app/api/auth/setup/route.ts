import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { setSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { DEFAULT_CHILDCARE_RULE, MEMBER_COLORS } from "@/lib/constants";

export async function GET() {
  const householdCount = await prisma.household.count();
  return NextResponse.json({ needsSetup: householdCount === 0 });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const body = await request.json();
    const { setupToken, name, email, password } = body as {
      setupToken?: string;
      name?: string;
      email?: string;
      password?: string;
    };

    const existing = await prisma.household.count();
    if (existing > 0) return apiError("This household is already set up", 409);

    if (!setupToken || setupToken !== process.env.SETUP_TOKEN) {
      return apiError("Incorrect setup code", 401);
    }
    if (!name || !email || !password || password.length < 8) {
      return apiError("Name, email and an 8+ character password are required", 422);
    }

    const household = await prisma.household.create({ data: {} });
    const member = await prisma.familyMember.create({
      data: {
        householdId: household.id,
        name,
        kind: "PARENT",
        colorToken: MEMBER_COLORS[0].token,
        icon: "dad",
      },
    });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        familyMemberId: member.id,
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        role: "ADMIN",
      },
    });
    await prisma.childcareRule.create({
      data: { householdId: household.id, ...DEFAULT_CHILDCARE_RULE },
    });
    await prisma.familySettings.create({
      data: { householdId: household.id, data: {} },
    });

    await setSession({ userId: user.id, role: user.role, householdId: household.id }, true);
    return NextResponse.json({ ok: true });
  });
}
