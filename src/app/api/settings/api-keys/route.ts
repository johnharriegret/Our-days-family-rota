import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { newIntegrationToken, tokenHash } from "@/lib/integrations/token";
import { PRIVATE_HEADERS } from "@/lib/integrations/auth";

export async function GET() {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    const keys = await prisma.aPIKey.findMany({ where: { householdId: session.householdId },
      select: { id: true, label: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" } });
    return NextResponse.json({ keys }, { headers: PRIVATE_HEADERS });
  });
}
export async function POST(request: Request) {
  return withApi(async () => {
    const session = await requireRole("ADMIN");
    // Keys are managed from this same-origin settings UI, never by API keys.
    if (request.headers.get("origin") !== new URL(request.url).origin) return apiError("Same-origin request required", 403);
    const body = await request.json();
    if (typeof body.label !== "string" || !body.label.trim() || body.label.trim().length > 80) return apiError("Label must contain 1–80 characters", 422);
    const token = newIntegrationToken();
    const key = await prisma.aPIKey.create({ data: { householdId: session.householdId, label: body.label.trim(), hash: tokenHash(token), scopes: ["calendar:read"] }, select: { id: true, label: true } });
    return NextResponse.json({ key, token }, { status: 201, headers: PRIVATE_HEADERS });
  });
}
