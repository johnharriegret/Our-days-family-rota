import { prisma } from "../prisma";
import { AuthError } from "../session";
import { readIntegrationToken, tokenHash } from "./token";

export async function requireIntegrationKey(request: Request, allowBasic = false) {
  const token = readIntegrationToken(request.headers.get("authorization"), allowBasic);
  if (!token) throw new AuthError("A read-only integration key is required");
  const key = await prisma.aPIKey.findUnique({ where: { hash: tokenHash(token) } });
  if (!key || key.revokedAt) throw new AuthError("Invalid or revoked integration key");
  if (!key.scopes.includes("calendar:read")) throw new AuthError("Calendar read scope required", 403);
  // Avoid a write on every poll. A failed audit timestamp must not hide the calendar.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 3_600_000) {
    await prisma.aPIKey.updateMany({ where: { id: key.id, revokedAt: null }, data: { lastUsedAt: new Date() } })
      .catch(() => console.error("Could not update integration key last-used timestamp"));
  }
  return key;
}
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
