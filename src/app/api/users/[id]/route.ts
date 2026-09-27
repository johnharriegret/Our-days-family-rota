import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";

// Revokes a family member's login (e.g. to reissue it with a new password -
// there's no reset flow yet, so removing and re-adding is how that's done).
// Never touches the FamilyMember itself, just their sign-in.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    const { id } = await params;
    const user = await prisma.user.findFirst({ where: { id, householdId: session.householdId } });
    if (!user) return apiError("Not found", 404);
    if (user.id === session.userId) return apiError("You can't remove your own login", 400);
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
