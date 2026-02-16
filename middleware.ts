import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookieName, verifySession, isAuthRequired } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Статика и внутренние роуты Next.js
  if (path.startsWith("/_next") || path.startsWith("/icon")) {
    return NextResponse.next();
  }

  // Пароль не задан в env — вход не требуем
  if (!isAuthRequired()) {
    return NextResponse.next();
  }

  // Страница входа, API логина и статуса — без проверки
  if (path === "/login" || path === "/api/auth/login" || path === "/api/auth/status") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(getSessionCookieName())?.value;
  const valid = await verifySession(cookie);
  if (!valid) {
    // API без авторизации — 401
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
