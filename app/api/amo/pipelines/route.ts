/**
 * GET: воронки и статусы для выбора в UI.
 */
import { NextResponse } from "next/server";
import { getPipelinesWithStatuses } from "@/lib/amo/amoService";

export async function GET() {
  try {
    const pipelines = await getPipelinesWithStatuses();
    return NextResponse.json(pipelines);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
