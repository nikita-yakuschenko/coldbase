/**
 * GET: редирект на OAuth AmoCRM.
 */
import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/amo/client";

export async function GET() {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
