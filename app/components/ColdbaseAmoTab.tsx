"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { normalizePhone } from "@/lib/normalizePhone";
import { Toast, type ToastVariant } from "@/app/components/Toast";

const STORAGE_KEY = "coldbase_upload_amo";
const STORAGE_KEY_LEGACY = "coldbase_upload";
/** При большем числе строк в sessionStorage сохраняем только мета (колонки, выбор), не строки — чтобы не блокировать UI и не упираться в лимит. */
const ROW_STORAGE_LIMIT = 500;

/** Колонки для проверки в CRM — только телефоны и email (остальные скрываем из выбора). */
function isColumnForCheck(colName: string): boolean {
  return /телефон|phone|email|e-mail|мейл|mail/i.test(colName);
}

/** Колонка «Рабочий телефон» (включая дубли типа «Рабочий телефон (2)»). */
function isWorkPhoneColumn(colName: string): boolean {
  return /рабочий\s*телефон|work\s*phone/i.test(colName);
}

/** По умолчанию выбираем все колонки с рабочим телефоном; если таких нет — первую подходящую для проверки. */
function getDefaultIdentifierColumns(columns: string[]): string[] {
  const checkCols = columns.filter(isColumnForCheck);
  const workPhoneCols = checkCols.filter(isWorkPhoneColumn);
  if (workPhoneCols.length > 0) return workPhoneCols;
  return checkCols.length > 0 ? [checkCols[0]] : [];
}

/** Колонка «Примечание к сделке» — в таблицах не выводим, чтобы не ломать структуру. */
function isNoteColumn(colName: string): boolean {
  return colName === "Примечание к сделке" || /^Примечание к сделке \(\d+\)$/.test(colName);
}

export default function ColdbaseAmoTab() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const rowsRef = useRef<Record<string, unknown>[]>([]);
  const [identifierColumns, setIdentifierColumns] = useState<string[]>([]);
  const [foundSet, setFoundSet] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [restoredTooLarge, setRestoredTooLarge] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: number; name: string; statuses: { id: number; name: string }[] }[]>([]);
  const [leadFields, setLeadFields] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [statusId, setStatusId] = useState<number | "">("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: { rowIndex: number; message: string }[] } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [showExclusionsTable, setShowExclusionsTable] = useState(false);
  const [showToAddTable, setShowToAddTable] = useState(false);
  const [exclusionPage, setExclusionPage] = useState(0);
  const [toAddPage, setToAddPage] = useState(0);
  const [showRestOfMapping, setShowRestOfMapping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ROWS_PER_PAGE = 10;
  const nameField = leadFields.find((f) => f.id === "name");
  const restLeadFields = leadFields.filter((f) => f.id !== "name");

  const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
    setToast({ message, variant });
  }, []);

  // Восстановление загруженного файла из sessionStorage при перезагрузке
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY_LEGACY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        columns?: string[];
        rows?: Record<string, unknown>[];
        identifierColumns?: string[];
        tooLarge?: boolean;
      };
      if (!data.columns?.length || !Array.isArray(data.identifierColumns)) return;
      const validCols = data.identifierColumns.filter(
        (c) => data.columns!.includes(c) && isColumnForCheck(c)
      );
      setColumns(data.columns);
      setIdentifierColumns(validCols);
      if (data.tooLarge) {
        setRowCount(0);
        rowsRef.current = [];
        setRestoredTooLarge(true);
      } else if (Array.isArray(data.rows)) {
        setRowCount(data.rows.length);
        rowsRef.current = data.rows;
      } else {
        setRowCount(0);
        rowsRef.current = [];
      }
    } catch {
      // невалидные данные — игнорируем
    }
  }, []);

  // Сохраняем в sessionStorage при смене данных или выбора колонок (без тысяч строк при больших базах)
  useEffect(() => {
    if (typeof window === "undefined" || columns.length === 0) return;
    try {
      if (rowCount > ROW_STORAGE_LIMIT) {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ columns, identifierColumns, tooLarge: true })
        );
      } else {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ columns, identifierColumns, rows: rowsRef.current })
        );
      }
    } catch {
      // quota — не перезаписываем
    }
  }, [columns, rowCount, identifierColumns]);

  const onReset = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY_LEGACY);
    } catch {
      // ignore
    }
    setColumns([]);
    setRowCount(0);
    rowsRef.current = [];
    setIdentifierColumns([]);
    setFoundSet(new Set());
    setHasSearched(false);
    setResult(null);
    setUploadError("");
    setRestoredTooLarge(false);
    setPipelines([]);
    setLeadFields([]);
    setPipelineId("");
    setStatusId("");
    setMapping({});
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setColumns([]);
    setRowCount(0);
    rowsRef.current = [];
    setFoundSet(new Set());
    setHasSearched(false);
    setResult(null);
    setRestoredTooLarge(false);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      const rows = (data.rows ?? []) as Record<string, unknown>[];
      const cols = (data.columns ?? []) as string[];
      const nextCols = getDefaultIdentifierColumns(cols);
      rowsRef.current = rows;
      setColumns(cols);
      setRowCount(rows.length);
      setIdentifierColumns(nextCols);
      if (rows.length <= ROW_STORAGE_LIMIT) {
        try {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ columns: cols, identifierColumns: nextCols, rows })
          );
        } catch {
          // quota
        }
      } else {
        try {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ columns: cols, identifierColumns: nextCols, tooLarge: true })
          );
        } catch {
          // quota
        }
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onSearch = useCallback(async () => {
    if (columns.length === 0 || identifierColumns.length === 0) return;
    const rows = rowsRef.current;
    setSearching(true);
    try {
      const valuesSet = new Set<string>();
      for (const r of rows) {
        for (const col of identifierColumns) {
          const v = String(r[col] ?? "").trim();
          if (v) valuesSet.add(v);
        }
      }
      const values = Array.from(valuesSet);
      const res = await fetch("/api/amo/contacts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка поиска");
      const foundArr = (data.found ?? []) as string[];
      const foundSetNew = new Set<string>(foundArr);
      setFoundSet(foundSetNew);
      setHasSearched(true);
      setShowExclusionsTable(false);
      setShowToAddTable(false);
      setExclusionPage(0);
      setToAddPage(0);
      const errs = data.errors ?? [];
      const canonicalVal = (raw: string) => {
        const t = raw.trim();
        const n = normalizePhone(t);
        return n.length >= 10 ? n : t;
      };
      const excludedRecordCount = rows.filter((r) =>
        identifierColumns.some((col) => {
          const raw = String(r[col] ?? "").trim();
          return raw && foundSetNew.has(canonicalVal(raw));
        })
      ).length;
      if (errs.length > 0) {
        const first = errs[0];
        showToast(`Поиск завершён с ошибками (${errs.length} значений не проверено). Пример: ${first}`, "warning");
      } else {
        showToast(`Найдено ${excludedRecordCount} исключённых записей`, "success");
      }
    } catch (err) {
      setFoundSet(new Set());
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [columns.length, identifierColumns, showToast]);

  const loadPipelinesAndFields = useCallback(async () => {
    try {
      const [pRes, fRes] = await Promise.all([
        fetch("/api/amo/pipelines"),
        fetch("/api/amo/leads/fields"),
      ]);
      const pData = await pRes.json();
      const fData = await fRes.json();
      if (!pRes.ok) throw new Error(pData.error);
      if (!fRes.ok) throw new Error(fData.error);
      setPipelines(pData);
      setLeadFields(fData);
      if (pData.length && !pipelineId) {
        const coldPipeline = pData.find((p: { name: string }) => /холодный\s*прозвон/i.test(p.name));
        const defaultPipeline = coldPipeline ?? pData[0];
        setPipelineId(defaultPipeline.id);
        const statuses = defaultPipeline.statuses ?? [];
        const coldStatus = statuses.find((s: { name: string }) => /база\s*на\s*холодн/i.test(s.name));
        if (coldStatus) setStatusId(coldStatus.id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }, [pipelineId, showToast]);

  const canonical = (raw: string) => {
    const t = raw.trim();
    const n = normalizePhone(t);
    return n.length >= 10 ? n : t;
  };
  // Производные списки — через useMemo, без пересчёта на каждом рендере
  const toAddRows = useMemo(() => {
    if (!hasSearched) return [];
    const rows = rowsRef.current;
    return rows.filter((r) =>
      !identifierColumns.some((col) => {
        const raw = String(r[col] ?? "").trim();
        return raw && foundSet.has(canonical(raw));
      })
    );
  }, [hasSearched, foundSet, identifierColumns]);
  const exclusionRows = useMemo(() => {
    if (!hasSearched) return [];
    const rows = rowsRef.current;
    return rows.filter((r) =>
      identifierColumns.some((col) => {
        const raw = String(r[col] ?? "").trim();
        return raw && foundSet.has(canonical(raw));
      })
    );
  }, [hasSearched, foundSet, identifierColumns]);

  const onSubmit = useCallback(async () => {
    if (columns.length === 0 || toAddRows.length === 0 || !pipelineId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/amo/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: toAddRows,
          columns,
          mapping,
          pipeline_id: Number(pipelineId),
          status_id: statusId || undefined,
          identifier_columns: identifierColumns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка создания лидов");
      setResult(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [columns, toAddRows, pipelineId, statusId, mapping, identifierColumns, showToast]);

  const currentPipeline = pipelineId ? pipelines.find((p) => p.id === pipelineId) : null;
  const currentStatuses = currentPipeline ? currentPipeline.statuses : [];

  return (
    <>
      <section className="card">
        <h2>1. Загрузите Excel с холодной базой</h2>
        <div className="file-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={onUpload}
          />
          {columns.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onReset}
              style={{ marginLeft: "0.75rem" }}
            >
              Сбросить файл
            </button>
          )}
        </div>
        {uploadError && <p className="error">{uploadError}</p>}
        {restoredTooLarge && (
          <p className="text-muted">Файл был слишком большой для восстановления, загрузите его снова.</p>
        )}
        {columns.length > 0 && (
          <p>Загружено колонок: {columns.length}, строк: {rowCount}</p>
        )}
      </section>

      {columns.length > 0 && (
        <>
          <section className="card">
            <h2>2. Колонки для проверки в CRM</h2>
            <p>Показаны только колонки с телефонами и email — по ним проверяем дубли.</p>
            <div className="columns-grid">
              {columns.filter(isColumnForCheck).map((c, i) => (
                <label key={`col-${i}-${c}`}>
                  <input
                    type="checkbox"
                    checked={identifierColumns.includes(c)}
                    onChange={(e) => {
                      if (e.target.checked) setIdentifierColumns((prev) => [...prev, c]);
                      else setIdentifierColumns((prev) => prev.filter((x) => x !== c));
                    }}
                  />
                  {c}
                </label>
              ))}
            </div>
            {columns.filter(isColumnForCheck).length === 0 && (
              <p className="text-muted">Нет колонок с телефоном или email — добавьте в файл колонки с «телефон» или «email» в названии.</p>
            )}
            <button
              className="btn btn-primary"
              onClick={onSearch}
              disabled={searching || identifierColumns.length === 0}
            >
              {searching ? "Поиск…" : "Проверить в AmoCRM"}
            </button>
          </section>

          <section className="card">
            <h3 className="card-section-title">Исключения (уже есть в CRM)<sup className="card-note-ref">*</sup></h3>
            <p className="card-note" aria-hidden="true">* Розовым подсвечено поле совпадения.</p>
            <div className="card-section-row">
              {hasSearched && exclusionRows.length > 0 && (
                <>
                  <span className="exclusions-count">{exclusionRows.length} записей</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShowExclusionsTable((v) => !v)}
                    style={{ marginLeft: "auto" }}
                  >
                    {showExclusionsTable ? (
                      <>Свернуть <ChevronUp style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                    ) : (
                      <>Развернуть таблицу <ChevronDown style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                    )}
                  </button>
                </>
              )}
            </div>
            {!hasSearched && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Сначала нажмите «Проверить в AmoCRM»</p>}
            {hasSearched && exclusionRows.length === 0 && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Исключений нет</p>}
            {hasSearched && exclusionRows.length > 0 && showExclusionsTable && (() => {
              const totalPages = Math.max(1, Math.ceil(exclusionRows.length / ROWS_PER_PAGE));
              const page = Math.min(exclusionPage, totalPages - 1);
              const slice = exclusionRows.slice(page * ROWS_PER_PAGE, page * ROWS_PER_PAGE + ROWS_PER_PAGE);
              const tableCols = columns.filter((c) => !isNoteColumn(c));
              return (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {tableCols.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {slice.map((row, i) => (
                          <tr key={page * ROWS_PER_PAGE + i}>
                            {tableCols.map((c) => {
                              const val = String(row[c] ?? "").trim();
                              const isMatch = identifierColumns.includes(c) && val !== "" && foundSet.has(canonical(val));
                              return (
                                <td key={c} className={isMatch ? "match-cell" : undefined}>
                                  {val || ""}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination-wrap">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={page <= 0}
                      onClick={() => setExclusionPage((p) => Math.max(0, p - 1))}
                    >
                      Назад
                    </button>
                    <span className="text-muted">Страница {page + 1} из {totalPages}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={page >= totalPages - 1}
                      onClick={() => setExclusionPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      Вперёд
                    </button>
                  </div>
                </>
              );
            })()}
          </section>

          <section className="card">
            <h3 className="card-section-title">К добавлению (лиды)</h3>
            <div className="card-section-row">
              {hasSearched && toAddRows.length > 0 && (
                <>
                  <span className="toadd-count">{toAddRows.length} записей</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setShowToAddTable((v) => !v)}
                    style={{ marginLeft: "auto" }}
                  >
                    {showToAddTable ? (
                      <>Свернуть <ChevronUp style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                    ) : (
                      <>Развернуть таблицу <ChevronDown style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                    )}
                  </button>
                </>
              )}
            </div>
            {!hasSearched && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Сначала нажмите «Проверить в AmoCRM»</p>}
            {hasSearched && toAddRows.length === 0 && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Записей к добавлению нет</p>}
            {hasSearched && toAddRows.length > 0 && showToAddTable && (() => {
              const totalPages = Math.max(1, Math.ceil(toAddRows.length / ROWS_PER_PAGE));
              const page = Math.min(toAddPage, totalPages - 1);
              const slice = toAddRows.slice(page * ROWS_PER_PAGE, page * ROWS_PER_PAGE + ROWS_PER_PAGE);
              const tableCols = columns.filter((c) => !isNoteColumn(c));
              return (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {tableCols.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {slice.map((row, i) => (
                          <tr key={page * ROWS_PER_PAGE + i}>
                            {tableCols.map((c) => (
                              <td key={c}>{String(row[c] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination-wrap">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={page <= 0}
                      onClick={() => setToAddPage((p) => Math.max(0, p - 1))}
                    >
                      Назад
                    </button>
                    <span className="text-muted">Страница {page + 1} из {totalPages}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={page >= totalPages - 1}
                      onClick={() => setToAddPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      Вперёд
                    </button>
                  </div>
                </>
              );
            })()}
          </section>

          <section className="card">
            <h2>3. Воронка и маппинг</h2>
            <button type="button" className="btn btn-ghost" onClick={loadPipelinesAndFields}>
              Загрузить воронки и поля лида
            </button>
            {pipelines.length > 0 && (
              <div className="mapping-top-row">
                <div className="mapping-top-item">
                  <label>Воронка</label>
                  <select
                    value={pipelineId}
                    onChange={(e) => {
                      setPipelineId(Number(e.target.value));
                      setStatusId("");
                    }}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {currentStatuses.length > 0 && (
                  <div className="mapping-top-item">
                    <label>Статус (этап)</label>
                    <select
                      value={statusId}
                      onChange={(e) => setStatusId(Number(e.target.value))}
                    >
                      <option value="">—</option>
                      {currentStatuses.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {nameField && (
                  <div className="mapping-top-item">
                    <label>{nameField.name} ← колонка Excel</label>
                    <select
                      value={mapping[nameField.id] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [nameField.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">—</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            {restLeadFields.length > 0 && (
              <div className="mapping-rest-wrap" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-ghost mapping-rest-toggle"
                  onClick={() => setShowRestOfMapping((v) => !v)}
                >
                  {showRestOfMapping ? (
                    <>Свернуть остальные поля <ChevronUp style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                  ) : (
                    <>Развернуть остальные поля ({restLeadFields.length}) <ChevronDown style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                  )}
                </button>
                {showRestOfMapping && (
                  <div className="mapping-grid">
                    {restLeadFields.map((f) => (
                      <div key={f.id} className="mapping-row">
                        <span>{f.name}</span>
                        <select
                          value={mapping[f.id] ?? ""}
                          onChange={(e) =>
                            setMapping((prev) => ({
                              ...prev,
                              [f.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          {columns.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {toAddRows.length > 0 && (
            <section className="card">
              <div className="card-section-row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                <button
                  className="btn btn-primary"
                  onClick={onSubmit}
                  disabled={submitting || !pipelineId}
                >
                  {submitting ? "Отправка…" : "Загрузить в CRM"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (columns.length === 0 || toAddRows.length === 0) return;
                    try {
                      const res = await fetch("/api/export-cleaned", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ columns, rows: toAddRows }),
                      });
                      if (!res.ok) throw new Error("Ошибка выгрузки");
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const d = new Date();
                      const dateStr = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `Очищенная холодная база ${dateStr}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      showToast(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  Сохранить очищенный файл
                </button>
              </div>
              {result && (
                <div>
                  <p className="success">
                    Создано лидов: {result.ok}. Ошибок: {result.errors.length}
                  </p>
                  {result.errors.length > 0 && (
                    <p className="error" style={{ marginTop: "0.5rem" }}>
                      {result.errors[0].message}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
          autoCloseMs={6000}
        />
      )}
    </>
  );
}
