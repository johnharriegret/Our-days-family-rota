import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api";
import { requireIntegrationKey, PRIVATE_HEADERS } from "@/lib/integrations/auth";
import { getCalendarRange } from "@/lib/calendarService";
import { addDays, todayInTimeZone } from "@/lib/engine/dates";
import { buildSummary, weekStart } from "@/lib/integrations/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const response = await withApi(async () => {
    const key = await requireIntegrationKey(request);
    const household = await prisma.household.findUniqueOrThrow({ where: { id: key.householdId } });
    const today = todayInTimeZone(household.timezone);
    const from = weekStart(today, household.weekStartsOn);
    const days = await getCalendarRange(key.householdId, addDays(from, -1), addDays(today, 60));
    return NextResponse.json(buildSummary(days, today, household.timezone, household.weekStartsOn));
  });
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="Our Days"');
  return response;
}
