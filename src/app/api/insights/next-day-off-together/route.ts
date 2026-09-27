import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { addDays } from "@/lib/engine";
import { getCalendarRange } from "@/lib/calendarService";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    if (!from) return apiError("from is required", 422);

    const to = addDays(from, 180);
    const days = await getCalendarRange(session.householdId, from, to);
    const match = days.find((d) => d.bothParentsOff);
    return NextResponse.json({ date: match?.date ?? null });
  });
}
