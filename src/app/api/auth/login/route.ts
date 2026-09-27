import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { setSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function POST(request: Request) {
  return withApi(async () => {
    const { email, password, remember } = (await request.json()) as {
      email?: string;
      password?: string;
      remember?: boolean;
    };
    if (!email || !password) return apiError("Email and password are required", 422);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return apiError("Incorrect email or password", 401);
    }

    await setSession(
      { userId: user.id, role: user.role, householdId: user.householdId },
      Boolean(remember),
    );
    return NextResponse.json({ ok: true, role: user.role });
  });
}
