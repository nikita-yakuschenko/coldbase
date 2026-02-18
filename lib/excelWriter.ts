/**
 * Сборка Excel из колонок и строк (для выгрузки очищенного файла).
 */
import * as XLSX from "xlsx";

export function buildExcelBuffer(columns: string[], rows: Record<string, unknown>[]): Buffer {
  const headerRow = columns;
  const dataRows = rows.map((row) =>
    columns.map((col) => {
      const v = row[col];
      if (v === undefined || v === null) return "";
      if (typeof v === "number" || typeof v === "boolean") return v;
      return String(v);
    })
  );
  const aoa = [headerRow, ...dataRows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Лист1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
