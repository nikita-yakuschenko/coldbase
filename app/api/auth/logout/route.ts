import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const res = NextResponse.redirect(new URL("/login", origin));
  res.cookies.set(getSessionCookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
