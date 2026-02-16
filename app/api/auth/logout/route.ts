import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const host = req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const res = NextResponse.redirect(new URL("/login", origin));
  res.cookies.set(getSessionCookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
