/**
 * POST: создание сделок в Bitrix24 (контакт + сделка по строкам).
 */
import { NextRequest, NextResponse } from "next/server";
import { createDealsBatch, type CreateB24Row } from "@/lib/b24/b24Service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = body.rows as Record<string, unknown>[];
    const columns = (body.columns as string[]) ?? [];
    const mapping = body.mapping as Record<string, string>;
    const category_id = Number(body.category_id);
    const stage_id = String(body.stage_id ?? "");
    const identifier_columns = (body.identifier_columns as string[]) ?? [];

    if (!Array.isArray(rows) || !mapping || !Number.isFinite(category_id) || !stage_id) {
      return NextResponse.json({ error: "Нужны rows, mapping, category_id, stage_id" }, { status: 400 });
    }

    const payload: CreateB24Row[] = rows.map((row) => ({
      row,
      mapping,
      category_id,
      stage_id,
      identifier_columns,
      columns: Array.isArray(columns) ? columns : [],
    }));

    const result = await createDealsBatch(payload);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
