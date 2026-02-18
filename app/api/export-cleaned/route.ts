/**
 * POST: columns + rows (только «к добавлению») → Excel-файл для скачивания.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildExcelBuffer } from "@/lib/excelWriter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const columns = body.columns as string[] | undefined;
    const rows = body.rows as Record<string, unknown>[] | undefined;

    if (!Array.isArray(columns) || columns.length === 0 || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: "Нужны columns и rows" },
        { status: 400 }
      );
    }

    const buffer = buildExcelBuffer(columns, rows);
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
    const filenameUtf8 = `Очищенная холодная база ${dateStr}.xlsx`;
    const filenameAscii = `cleaned-coldbase-${dateStr.replace(/\./g, "-")}.xlsx`;
    const contentDisposition = `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[export-cleaned]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
