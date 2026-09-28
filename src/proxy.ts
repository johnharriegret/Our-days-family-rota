import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/jwt";

const PUBLIC_PATHS = [
  "/login",
  "/setup",
  // Android's WebAPK service fetches these without the user's session cookie.
  // They must stay public or Chrome disables Install and only offers a plain
  // browser shortcut. No household data is exposed by any of these assets.
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("our_days_session")?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
