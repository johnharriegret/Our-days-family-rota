import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { applyMumWeekPlan, getMumMonthPlan, getMumWeekPlan } from "@/lib/optimiserService";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId");
    const weekStartsParam = url.searchParams.get("weekStarts");
    const weekStart = url.searchParams.get("weekStart");
    if (!ownerId) return apiError("ownerId is required", 422);

    // Several weeks together (Plan the month) are computed sequentially,
    // each one chained onto the last, so a week's own suggested Sunday is
    // visible to the following week's Monday - see getMumMonthPlan's own
    // comment for why that matters. A single week (Plan the week) reads the
    // real saved state as before; the two share all the same logic
    // otherwise, this just chooses what "the day before" comes from.
    if (weekStartsParam) {
      const weekStarts = weekStartsParam.split(",").map((s) => s.trim());
      if (weekStarts.length === 0 || weekStarts.some((s) => !DATE_RE.test(s))) {
        return apiError("weekStarts must be a comma-separated list of YYYY-MM-DD dates", 422);
      }
      const plans = await getMumMonthPlan(session.householdId, ownerId, weekStarts);
      return NextResponse.json({ plans });
    }

    if (!weekStart || !DATE_RE.test(weekStart)) {
      return apiError("ownerId and weekStart (YYYY-MM-DD), or weekStarts, are required", 422);
    }
    const plan = await getMumWeekPlan(session.householdId, ownerId, weekStart);
    return NextResponse.json(plan);
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { ownerId, assignments, allowConflicts } = body as {
      ownerId?: string;
      assignments?: { date: string; shiftTypeId: string | null }[];
      /** apply a plan that has a known childcare conflict - a deliberate override. */
      allowConflicts?: boolean;
    };
    if (!ownerId || !Array.isArray(assignments)) {
      return apiError("ownerId and assignments are required", 422);
    }
    for (const a of assignments) {
      if (!a || !DATE_RE.test(a.date)) return apiError("each assignment needs a valid date", 422);
    }
    // Whatever the browser sends is re-checked against the household's
    // childcare rules here, so the schedule that gets saved is a schedule that
    // has actually been validated - not just one that looked fine in a sheet
    // that may have been open for a while.
    const result = await applyMumWeekPlan(session.householdId, ownerId, assignments, {
      allowConflicts: allowConflicts === true,
    });
    if (result.blocked) {
      return NextResponse.json(
        { error: result.blocked.message, conflicts: result.blocked.conflicts },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  });
}
