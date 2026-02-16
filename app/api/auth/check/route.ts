/**
 * Проверка авторизации (Node runtime). Если пароль включён и cookie нет — 401.
 * Нужен как запас к middleware, когда на Edge env не доходит.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName, verifySession, isAuthRequired } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAuthRequired()) {
    return NextResponse.json({ ok: true });
  }
  const cookie = req.cookies.get(getSessionCookieName())?.value;
  const valid = await verifySession(cookie);
  if (!valid) {
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
