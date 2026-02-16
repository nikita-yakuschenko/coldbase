/**
 * POST: приём Excel (multipart или JSON base64), парсинг, возврат колонок и строк.
 */
import { NextRequest, NextResponse } from "next/server";
import { parseExcel } from "@/lib/excelParser";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let buffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      const base64 = body.file ?? body.base64;
      if (!base64) {
        return NextResponse.json({ error: "В теле ожидается file/base64" }, { status: 400 });
      }
      buffer = Buffer.from(base64, "base64");
    } else {
      return NextResponse.json({ error: "Нужен multipart/form-data или JSON с base64" }, { status: 400 });
    }

    const parsed = parseExcel(buffer);
    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
