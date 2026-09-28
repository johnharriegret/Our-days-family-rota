import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { DEFAULT_TOGETHER_COLOR } from "@/lib/constants";

type AppearanceData = {
  togetherColor?: string;
  hiddenCalendarChildIds?: string[];
};

export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const settings = await prisma.familySettings.findUnique({ where: { householdId: session.householdId } });
    const data = (settings?.data ?? {}) as AppearanceData;
    return NextResponse.json({
      togetherColor: data.togetherColor ?? DEFAULT_TOGETHER_COLOR,
      hiddenCalendarChildIds: Array.isArray(data.hiddenCalendarChildIds) ? data.hiddenCalendarChildIds : [],
    });
  });
}

// FamilySettings.data is a small free-form bag shared by anything that
// doesn't need its own table yet - merge in just this one key rather than
// overwriting whatever else might be stored there.
export async function PATCH(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const { togetherColor, hiddenCalendarChildIds } = (await request.json()) as {
      togetherColor?: string;
      hiddenCalendarChildIds?: unknown;
    };
    const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
    if (togetherColor !== undefined && !HEX_RE.test(togetherColor)) {
      return apiError("togetherColor must be a hex colour", 422);
    }
    if (hiddenCalendarChildIds !== undefined && (
      !Array.isArray(hiddenCalendarChildIds)
      || hiddenCalendarChildIds.some((id) => typeof id !== "string")
    )) {
      return apiError("hiddenCalendarChildIds must be a list of member IDs", 422);
    }
    if (togetherColor === undefined && hiddenCalendarChildIds === undefined) {
      return apiError("No appearance setting was supplied", 422);
    }

    const existing = await prisma.familySettings.findUnique({ where: { householdId: session.householdId } });
    const current = (existing?.data ?? {}) as AppearanceData;
    const data: AppearanceData = {
      ...current,
      ...(togetherColor !== undefined ? { togetherColor } : {}),
      ...(hiddenCalendarChildIds !== undefined
        ? { hiddenCalendarChildIds: [...new Set(hiddenCalendarChildIds as string[])] }
        : {}),
    };
    await prisma.familySettings.upsert({
      where: { householdId: session.householdId },
      create: { householdId: session.householdId, data },
      update: { data },
    });
    return NextResponse.json({
      togetherColor: data.togetherColor ?? DEFAULT_TOGETHER_COLOR,
      hiddenCalendarChildIds: data.hiddenCalendarChildIds ?? [],
    });
  });
}
