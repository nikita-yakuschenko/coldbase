/**
 * POST: значения телефонов/email → найденные в Bitrix24 (дубликаты контактов).
 */
import { NextRequest, NextResponse } from "next/server";
import { searchContactsByValues } from "@/lib/b24/b24Service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const values: string[] = Array.isArray(body.values) ? body.values : [];
    const { found, errors } = await searchContactsByValues(values);
    return NextResponse.json({ found: Array.from(found), errors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[coldbase] b24/contacts/search:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
