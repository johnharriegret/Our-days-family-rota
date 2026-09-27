import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { DEFAULT_TOGETHER_COLOR } from "@/lib/constants";

type AppearanceData = { togetherColor?: string };

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const settings = await prisma.familySettings.findUnique({ where: { householdId: session.householdId } });
    const data = (settings?.data ?? {}) as AppearanceData;
    return NextResponse.json({ togetherColor: data.togetherColor ?? DEFAULT_TOGETHER_COLOR });
  });
}

// FamilySettings.data is a small free-form bag shared by anything that
// doesn't need its own table yet - merge in just this one key rather than
// overwriting whatever else might be stored there.
export async function PATCH(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { togetherColor } = (await request.json()) as { togetherColor?: string };
    const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
    if (!togetherColor || !HEX_RE.test(togetherColor)) {
      return apiError("togetherColor must be a hex colour", 422);
    }

    const existing = await prisma.familySettings.findUnique({ where: { householdId: session.householdId } });
    const data = { ...((existing?.data ?? {}) as AppearanceData), togetherColor };
    await prisma.familySettings.upsert({
      where: { householdId: session.householdId },
      create: { householdId: session.householdId, data },
      update: { data },
    });
    return NextResponse.json({ togetherColor });
  });
}
