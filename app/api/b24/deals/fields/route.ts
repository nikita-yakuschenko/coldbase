/**
 * GET: поля сделки для маппинга (TITLE, OPPORTUNITY, COMMENTS, UF_*).
 */
import { NextResponse } from "next/server";
import { getDealFieldsForMapping } from "@/lib/b24/b24Service";

export async function GET() {
  try {
    const data = await getDealFieldsForMapping();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[coldbase] b24/deals/fields:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
