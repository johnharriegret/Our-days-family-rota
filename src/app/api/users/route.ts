import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

// Gives an existing family member their own sign-in, separate from whoever
// ran /setup. Admin-only: creating credentials for someone else is
// sensitive, and the household only ever has one admin (the person who set
// it up) - anyone else gets PARENT or CHILD, matching their FamilyMember kind.
export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    const body = await request.json();
    const { familyMemberId, email, password } = body as {
      familyMemberId?: string;
      email?: string;
      password?: string;
    };
    if (!familyMemberId || !email || !password) {
      return apiError("familyMemberId, email and password are required", 422);
    }
    if (password.length < 8) return apiError("Password must be at least 8 characters", 422);

    const member = await prisma.familyMember.findFirst({
      where: { id: familyMemberId, householdId: session.householdId, archived: false },
      include: { user: true },
    });
    if (!member) return apiError("That family member wasn't found", 404);
    if (member.user) return apiError(`${member.name} already has a login`, 409);

    const existingEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingEmail) return apiError("That email is already in use", 409);

    const user = await prisma.user.create({
      data: {
        householdId: session.householdId,
        familyMemberId: member.id,
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        role: member.kind === "PARENT" ? "PARENT" : "CHILD",
      },
    });
    return NextResponse.json({ login: { id: user.id, email: user.email } });
  });
}
