/**
 * GET: список полей лида (встроенные + кастомные) для маппинга.
 */
import { NextResponse } from "next/server";
import { getLeadFields } from "@/lib/amo/amoService";

export async function GET() {
  try {
    const fields = await getLeadFields();
    return NextResponse.json(fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
