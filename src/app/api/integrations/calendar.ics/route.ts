import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, withApi } from "@/lib/api";
import { requireIntegrationKey, PRIVATE_HEADERS } from "@/lib/integrations/auth";
import { getCalendarRange } from "@/lib/calendarService";
import { addDays, todayInTimeZone } from "@/lib/engine/dates";
import { calendarICS } from "@/lib/integrations/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const response = await withApi(async () => {
    const key = await requireIntegrationKey(request, true);
    const kind = new URL(request.url).searchParams.get("kind") ?? "all";
    if (!["all", "events", "shifts", "together"].includes(kind)) return apiError("kind must be all, events, shifts or together", 422);
    const household = await prisma.household.findUniqueOrThrow({ where: { id: key.householdId } });
    const today = todayInTimeZone(household.timezone);
    const days = await getCalendarRange(key.householdId, addDays(today, -8), addDays(today, 84));
    return new NextResponse(calendarICS(days, household.timezone, new Date(), kind), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
  });
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  if (response.status === 401) response.headers.set("WWW-Authenticate", 'Basic realm="Our Days", charset="UTF-8"');
  return response;
}
