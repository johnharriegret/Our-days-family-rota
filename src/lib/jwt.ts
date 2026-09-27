// Split out from auth.ts so Edge Middleware (which can verify sessions but
// must never pull in node:crypto) only ever imports this file, not the
// password-hashing helpers that need the Node runtime.
import { SignJWT, jwtVerify } from "jose";

function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = { userId: string; role: string; householdId: string };

export async function signSession(payload: SessionPayload, remember: boolean): Promise<string> {
  return new SignJWT({ role: payload.role, householdId: payload.householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(remember ? "180d" : "1d")
    .sign(sessionKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (!payload.sub || !payload.role || !payload.householdId) return null;
    return {
      userId: String(payload.sub),
      role: String(payload.role),
      householdId: String(payload.householdId),
    };
  } catch {
    return null;
  }
}
