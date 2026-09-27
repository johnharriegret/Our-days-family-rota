import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const events = await prisma.event.findMany({
      where: {
        householdId: session.householdId,
        ...(from && to && { date: { gte: new Date(from), lte: new Date(to) } }),
      },
      orderBy: { date: "asc" },
    });
    return NextResponse.json({ events });
  });
}

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const body = await request.json();
    const { title, memberIds, date, startLocal, endLocal, category } = body as {
      title?: string;
      memberIds?: string[];
      date?: string;
      startLocal?: string | null;
      endLocal?: string | null;
      category?: "APPOINTMENT" | "ACTIVITY" | "HOLIDAY" | "OTHER";
    };
    if (!title || !date) return apiError("title and date are required", 422);

    const event = await prisma.event.create({
      data: {
        householdId: session.householdId,
        title,
        memberIds: memberIds ?? [],
        date: new Date(date),
        startLocal: startLocal || null,
        endLocal: endLocal || null,
        category: category ?? "OTHER",
      },
    });
    return NextResponse.json({ event });
  });
}
