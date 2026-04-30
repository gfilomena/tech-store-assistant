import { NextResponse } from "next/server";
import { cookieName, createAuthCookieValue } from "../../../../src/auth/authCookie";

export const runtime = "nodejs";

function mustGetEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const username = (form.get("username") || "").toString();
  const password = (form.get("password") || "").toString();
  const next = (form.get("next") || "/").toString() || "/";

  const expectedUser = mustGetEnv("AUTH_USERNAME");
  const expectedPass = mustGetEnv("AUTH_PASSWORD");

  if (username !== expectedUser || password !== expectedPass) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  res.cookies.set({
    name: cookieName(),
    value: await createAuthCookieValue(username),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}

