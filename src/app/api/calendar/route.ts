import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { getCalendarRange } from "@/lib/calendarService";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return apiError("from and to (YYYY-MM-DD) are required", 422);

    const days = await getCalendarRange(session.householdId, from, to);
    return NextResponse.json({ days });
  });
}
