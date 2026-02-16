import { NextResponse } from "next/server";
import { isAuthRequired } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ required: isAuthRequired() });
}
