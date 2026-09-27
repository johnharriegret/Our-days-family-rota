import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

export async function GET(request: Request) {
  return withApi(async () => {
    const session = await requireSession();
    const ownerId = new URL(request.url).searchParams.get("ownerId");
    if (!ownerId) return apiError("ownerId is required", 422);

    const pattern = await prisma.shiftPattern.findFirst({
      where: { householdId: session.householdId, ownerId, archivedAt: null },
      include: { blocks: { orderBy: { order: "asc" } } },
      orderBy: { version: "desc" },
    });
    return NextResponse.json({ pattern });
  });
}

type BlockInput = { kind: string; count: number; startLocal?: string | null; endLocal?: string | null };

export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN", "PARENT");
    const body = await request.json();
    const { ownerId, anchor, blocks } = body as {
      ownerId?: string;
      anchor?: string;
      blocks?: BlockInput[];
    };
    if (!ownerId || !anchor || !blocks?.length) {
      return apiError("ownerId, anchor and at least one block are required", 422);
    }
    for (const block of blocks) {
      if (!block.kind || !block.count || block.count < 1) {
        return apiError("Every block needs a kind and a count of at least 1", 422);
      }
      if (block.kind !== "O" && (!block.startLocal || !block.endLocal)) {
        return apiError(`Block "${block.kind}" needs a start and end time`, 422);
      }
    }

    const owner = await prisma.familyMember.findFirst({
      where: { id: ownerId, householdId: session.householdId },
    });
    if (!owner) return apiError("Family member not found", 404);

    const previous = await prisma.shiftPattern.findFirst({
      where: { householdId: session.householdId, ownerId, archivedAt: null },
      orderBy: { version: "desc" },
    });

    // The FIRST rota a person ever saves should describe their whole calendar,
    // so it takes effect from its own anchor date (there is no history to
    // protect yet). A later correction only takes effect from today onward, so
    // past days keep whatever the earlier version showed.
    const effectiveFrom = previous ? new Date() : new Date(`${anchor}T00:00:00.000Z`);

    const pattern = await prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.shiftPattern.update({ where: { id: previous.id }, data: { archivedAt: new Date() } });
      }
      return tx.shiftPattern.create({
        data: {
          householdId: session.householdId,
          ownerId,
          anchor: new Date(anchor),
          effectiveFrom,
          version: (previous?.version ?? 0) + 1,
          blocks: {
            create: blocks.map((b, index) => ({
              order: index,
              kind: b.kind,
              count: b.count,
              startLocal: b.startLocal ?? null,
              endLocal: b.endLocal ?? null,
            })),
          },
        },
        include: { blocks: { orderBy: { order: "asc" } } },
      });
    });

    return NextResponse.json({ pattern });
  });
}
