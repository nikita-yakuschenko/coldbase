/**
 * POST: массив значений идентификатора (например телефоны) → множество найденных в AmoCRM.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchContactsByValues } from "@/lib/amo/amoService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const values: string[] = Array.isArray(body.values) ? body.values : [];
    const { found, errors } = await searchContactsByValues(values);
    if (errors.length > 0) {
      console.warn("[coldbase] contacts/search errors:", errors.slice(0, 3));
    }
    return NextResponse.json({ found: Array.from(found), errors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[coldbase] contacts/search failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
