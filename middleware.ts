import { NextResponse, type NextRequest } from "next/server";
import { cookieName, verifyAuthCookieValue } from "./src/auth/authCookie";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Public routes
  if (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const v = req.cookies.get(cookieName())?.value;
  const ok = await verifyAuthCookieValue(v);
  if (ok.ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Run on all paths except static assets (handled above too, but this reduces invocations)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

