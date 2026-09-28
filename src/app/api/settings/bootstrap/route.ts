import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { withApi } from "@/lib/api";
import { DEFAULT_TOGETHER_COLOR } from "@/lib/constants";

type AppearanceData = { togetherColor?: string; hiddenCalendarChildIds?: string[] };

/**
 * Everything the Settings page needs for its first render, in one request.
 * Before this, Settings fired five or six separate API calls on mount
 * (family-members, schools - fetched twice, once by the page and again by
 * SchoolsSection - shift-types, patterns, childcare-rule), each its own
 * serverless function invocation with its own Prisma/Postgres connection
 * cost. On a real household this was the main cause of Settings feeling
 * slow to open. Each section still fetches on its own after a save, exactly
 * as before - this route only replaces the redundant fan-out on first load.
 */
export async function GET() {
  return withApi(async () => {
    const session = await requireSession();
    const householdId = session.householdId;

    const [members, schools, childcareRule, appearance] = await Promise.all([
      prisma.familyMember.findMany({
        where: { householdId, archived: false },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { kind: "asc" },
      }),
      prisma.school.findMany({
        where: { householdId },
        include: { terms: { orderBy: { startDate: "asc" } } },
        orderBy: { name: "asc" },
      }),
      prisma.childcareRule.findFirst({
        where: { householdId },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.familySettings.findUnique({ where: { householdId } }),
    ]);
    const appearanceData = (appearance?.data ?? {}) as AppearanceData;
    const togetherColor = appearanceData.togetherColor ?? DEFAULT_TOGETHER_COLOR;
    const hiddenCalendarChildIds = Array.isArray(appearanceData.hiddenCalendarChildIds)
      ? appearanceData.hiddenCalendarChildIds
      : [];

    const parentIds = members.filter((m) => m.kind === "PARENT").map((m) => m.id);

    const [patterns, shiftTypes] = await Promise.all([
      prisma.shiftPattern.findMany({
        where: { householdId, ownerId: { in: parentIds }, archivedAt: null },
        include: { blocks: { orderBy: { order: "asc" } } },
        orderBy: { version: "desc" },
      }),
      prisma.shiftType.findMany({
        where: { householdId, ownerId: { in: parentIds }, archived: false },
        orderBy: { name: "asc" },
      }),
    ]);

    // One active (non-archived) pattern per owner already, by construction -
    // keep only the first just in case, same as the per-owner route's findFirst.
    const patternsByOwnerId: Record<string, (typeof patterns)[number]> = {};
    for (const p of patterns) {
      if (!patternsByOwnerId[p.ownerId]) patternsByOwnerId[p.ownerId] = p;
    }
    const shiftTypesByOwnerId: Record<string, typeof shiftTypes> = {};
    for (const t of shiftTypes) {
      (shiftTypesByOwnerId[t.ownerId] ??= []).push(t);
    }

    const membersOut = members.map(({ user, ...m }) => ({
      ...m,
      login: user ? { id: user.id, email: user.email } : null,
    }));

    return NextResponse.json({ members: membersOut, schools, childcareRule, patternsByOwnerId, shiftTypesByOwnerId, togetherColor, hiddenCalendarChildIds });
  });
}
