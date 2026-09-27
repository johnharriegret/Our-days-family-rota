import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { applyMumWeekPlan, getMumWeekPlan } from "@/lib/optimiserService";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId");
    const weekStart = url.searchParams.get("weekStart");
    if (!ownerId || !weekStart || !DATE_RE.test(weekStart)) {
      return apiError("ownerId and weekStart (YYYY-MM-DD) are required", 422);
    }
    const plan = await getMumWeekPlan(session.householdId, ownerId, weekStart);
    return NextResponse.json(plan);
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { ownerId, assignments } = body as {
      ownerId?: string;
      assignments?: { date: string; shiftTypeId: string | null }[];
    };
    if (!ownerId || !Array.isArray(assignments)) {
      return apiError("ownerId and assignments are required", 422);
    }
    for (const a of assignments) {
      if (!a || !DATE_RE.test(a.date)) return apiError("each assignment needs a valid date", 422);
    }
    const result = await applyMumWeekPlan(session.householdId, ownerId, assignments);
    return NextResponse.json(result);
  });
}
