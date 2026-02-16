import { NextRequest, NextResponse } from "next/server";
import { signSession, checkPassword, getSessionCookieName } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Неверный формат" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const token = await signSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 дней
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
