import { cookies } from "next/headers";
import { signSession, verifySession, type SessionPayload } from "./auth";

const COOKIE_NAME = "our_days_session";

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSession(payload: SessionPayload, remember: boolean): Promise<void> {
  const token = await signSession(payload, remember);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: remember ? 180 * 86400 : 86400,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new AuthError("Not signed in");
  return session;
}

export async function requireRole(...roles: Array<"ADMIN" | "PARENT" | "CHILD">): Promise<SessionPayload> {
  const session = await requireSession();
  if (!roles.includes(session.role as "ADMIN" | "PARENT" | "CHILD")) {
    throw new AuthError("Not permitted", 403);
  }
  return session;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}
