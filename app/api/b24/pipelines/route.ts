/**
 * GET: воронки сделок и стадии Bitrix24.
 */
import { NextResponse } from "next/server";
import { getPipelinesWithStatuses } from "@/lib/b24/b24Service";

export async function GET() {
  try {
    const data = await getPipelinesWithStatuses();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[coldbase] b24/pipelines:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
