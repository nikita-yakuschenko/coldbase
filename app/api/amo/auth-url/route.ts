/**
 * GET: URL для OAuth AmoCRM (переход пользователя для выдачи кода).
 */
import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/amo/client";

export async function GET() {
  const url = getAuthUrl();
  return NextResponse.json({ url });
}
