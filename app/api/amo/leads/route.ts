/**
 * POST: создание лидов — строки «к добавлению» + маппинг + pipeline_id, status_id, колонка-идентификатор.
 */
import { NextRequest, NextResponse } from "next/server";
import { createLeads, CreateLeadRow } from "@/lib/amo/amoService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = body.rows as Record<string, unknown>[];
    const mapping = body.mapping as Record<string, string>;
    const pipeline_id = Number(body.pipeline_id);
    const status_id = body.status_id != null ? Number(body.status_id) : undefined;
    const identifierColumns = (body.identifier_columns as string[]) ?? (body.identifier_column ? [body.identifier_column] : []);

    if (!Array.isArray(rows) || !mapping || typeof pipeline_id !== "number" || !pipeline_id) {
      return NextResponse.json(
        { error: "Нужны rows, mapping, pipeline_id" },
        { status: 400 }
      );
    }

    const payload: CreateLeadRow[] = rows.map((row) => {
      let identifierValue: string | undefined;
      if (Array.isArray(identifierColumns) && identifierColumns.length > 0) {
        for (const col of identifierColumns) {
          const v = String(row[col] ?? "").trim();
          if (v) {
            identifierValue = v;
            break;
          }
        }
      }
      return {
        row,
        mapping,
        pipeline_id,
        status_id,
        identifierValue,
      };
    });

    const result = await createLeads(payload);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
