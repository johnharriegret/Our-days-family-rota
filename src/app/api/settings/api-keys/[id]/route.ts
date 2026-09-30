import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { PRIVATE_HEADERS } from "@/lib/integrations/auth";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    if (request.headers.get("origin") !== new URL(request.url).origin) return apiError("Same-origin request required", 403);
    const { id } = await context.params;
    const result = await prisma.aPIKey.updateMany({ where: { id, householdId: session.householdId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) return apiError("Active key not found", 404);
    return NextResponse.json({ revoked: true }, { headers: PRIVATE_HEADERS });
  });
}
