/**
 * Парсинг Excel: из буфера возвращаем колонки и строки (массив объектов по заголовкам).
 */
import * as XLSX from "xlsx";

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function parseExcel(buffer: Buffer): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    return { columns: [], rows: [] };
  }
  const data = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: "",
  }) as unknown[][];
  if (data.length === 0) {
    return { columns: [], rows: [] };
  }
  const rawHeaders = (data[0] as unknown[]).map((c) => String(c ?? "").trim() || null);
  const columns: string[] = [];
  const count = new Map<string, number>();
  rawHeaders.forEach((name, i) => {
    const base = name || `Колонка_${i + 1}`;
    const n = (count.get(base) ?? 0) + 1;
    count.set(base, n);
    const unique = n === 1 ? base : `${base} (${n})`;
    columns.push(unique);
  });
  const rows = data.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const v = row[i];
      obj[col] = v === undefined || v === null ? "" : v;
    });
    return obj;
  });
  return { columns, rows };
}
