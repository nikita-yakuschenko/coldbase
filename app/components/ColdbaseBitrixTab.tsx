"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { normalizePhone } from "@/lib/normalizePhone";
import { Toast, type ToastVariant } from "@/app/components/Toast";

const STORAGE_KEY = "coldbase_upload_b24";
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

/** Воронка выбрана: не использовать !pipelineId — в Bitrix id воронки бывает 0. */
function findPipeline(
  pipelines: { id: number; name: string; statuses: { id: string; name: string }[] }[],
  pipelineId: number | ""
) {
  if (pipelineId === "") return null;
  return pipelines.find((p) => Number(p.id) === Number(pipelineId)) ?? null;
}

/** «Холодный прозвон» / «Холодный обзвон» и т.п. — в Bitrix24 названия разные (обзвон ≠ прозвон). */
function isColdCallingPipelineName(name: string): boolean {
  const n = name.toLowerCase();
  if (/холодн/.test(n) && /(прозвон|обзвон)/.test(n)) return true;
  if (/холодн\s*база/.test(n)) return true;
  return false;
}

/**
 * Воронка по умолчанию: опционально id из .env (NEXT_PUBLIC_B24_DEFAULT_DEAL_CATEGORY_ID),
 * иначе совпадение по имени (холодный …), иначе первая в ответе API (часто id=0 — другая воронка).
 */
function pickDefaultPipelineId(pipelines: { id: number; name: string }[]): number {
  const raw = process.env.NEXT_PUBLIC_B24_DEFAULT_DEAL_CATEGORY_ID;
  if (raw) {
    const want = Number(String(raw).trim());
    if (Number.isFinite(want)) {
      const hit = pipelines.find((p) => Number(p.id) === want);
      if (hit) return hit.id;
    }
  }
  const cold = pipelines.find((p) => isColdCallingPipelineName(p.name));
  return cold?.id ?? pipelines[0].id;
}

export default function ColdbaseBitrixTab() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const rowsRef = useRef<Record<string, unknown>[]>([]);
  const [identifierColumns, setIdentifierColumns] = useState<string[]>([]);
  const [foundSet, setFoundSet] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [restoredTooLarge, setRestoredTooLarge] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: number; name: string; statuses: { id: string; name: string }[] }[]>([]);
  const [dealFields, setDealFields] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<number | "">("");
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
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ROWS_PER_PAGE = 10;
  const nameField = dealFields.find((f) => f.id === "TITLE");
  const restDealFields = dealFields.filter((f) => f.id !== "TITLE");

  const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
    setToast({ message, variant });
  }, []);

  // Воронки уже загружены, а выбор пустой — «холодный обзвон» / env, не слепо pipelines[0] (часто category 0).
  useEffect(() => {
    if (pipelines.length === 0 || pipelineId !== "") return;
    setPipelineId(pickDefaultPipelineId(pipelines));
  }, [pipelines, pipelineId]);

  // Восстановление загруженного файла из sessionStorage при перезагрузке
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
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
    setDealFields([]);
    setPipelineId("");
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
      const res = await fetch("/api/b24/contacts/search", {
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
        showToast(`Найдено ${excludedRecordCount} исключённых записей (Bitrix24)`, "success");
      }
    } catch (err) {
      setFoundSet(new Set());
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [columns.length, identifierColumns, showToast]);

  const loadPipelinesAndFields = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const [pRes, fRes] = await Promise.all([
        fetch("/api/b24/pipelines"),
        fetch("/api/b24/deals/fields"),
      ]);
      const pData = await pRes.json();
      const fData = await fRes.json();
      if (!pRes.ok) throw new Error(pData.error);
      if (!fRes.ok) throw new Error(fData.error);
      setPipelines(pData);
      setDealFields(fData);
      if (pData.length && pipelineId === "") {
        setPipelineId(pickDefaultPipelineId(pData));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setPipelinesLoading(false);
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
    const stage = findPipeline(pipelines, pipelineId)?.statuses[0]?.id ?? "";
    if (columns.length === 0 || toAddRows.length === 0 || pipelineId === "" || !stage) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/b24/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: toAddRows,
          columns,
          mapping,
          category_id: Number(pipelineId),
          stage_id: stage,
          identifier_columns: identifierColumns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка создания сделок в Bitrix24");
      setResult(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [columns, toAddRows, pipelineId, pipelines, mapping, identifierColumns, showToast]);

  const currentPipeline = findPipeline(pipelines, pipelineId);
  const currentStatuses = currentPipeline ? currentPipeline.statuses : [];
  const firstStageId = currentStatuses[0]?.id ?? "";

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
              {searching ? "Поиск…" : "Проверить в Bitrix24"}
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
            {!hasSearched && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Сначала нажмите «Проверить в Bitrix24»</p>}
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
            <h3 className="card-section-title">К добавлению (сделки)</h3>
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
            {!hasSearched && <p className="text-muted" style={{ marginTop: "0.5rem" }}>Сначала нажмите «Проверить в Bitrix24»</p>}
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
            <div className="mapping-load-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={loadPipelinesAndFields}
                disabled={pipelinesLoading}
              >
                {pipelinesLoading
                  ? "Загрузка из Bitrix24…"
                  : pipelines.length > 0
                    ? "Обновить воронки и поля"
                    : "Загрузить воронки и поля сделки"}
              </button>
              {pipelines.length > 0 && !pipelinesLoading && (
                <span className="text-muted mapping-load-hint">Данные уже подгружены — кнопка обновляет список.</span>
              )}
            </div>
            {pipelines.length > 0 && (
              <div className="mapping-top-row">
                <div className="mapping-top-item">
                  <label>Воронка</label>
                  <select
                    value={pipelineId === "" ? "" : String(pipelineId)}
                    onChange={(e) => setPipelineId(Number(e.target.value))}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {currentStatuses.length > 0 && (
                    <span className="text-muted" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                      Сделки создаются на первом этапе: {currentStatuses[0].name}
                    </span>
                  )}
                </div>
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
            {restDealFields.length > 0 && (
              <div className="mapping-rest-wrap" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn btn-ghost mapping-rest-toggle"
                  onClick={() => setShowRestOfMapping((v) => !v)}
                >
                  {showRestOfMapping ? (
                    <>Свернуть остальные поля <ChevronUp style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                  ) : (
                    <>Развернуть остальные поля ({restDealFields.length}) <ChevronDown style={{ width: 16, height: 16, verticalAlign: "middle" }} /></>
                  )}
                </button>
                {showRestOfMapping && (
                  <div className="mapping-grid">
                    {restDealFields.map((f) => (
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
                  disabled={submitting || pipelineId === "" || !firstStageId}
                  title={
                    pipelineId === "" || !firstStageId
                      ? "Сначала в шаге 3 нажмите «Загрузить воронки…», выберите воронку; этап подставится автоматически (первый столбец)."
                      : undefined
                  }
                >
                  {submitting ? "Отправка…" : "Загрузить в CRM"}
                </button>
                {toAddRows.length > 0 && pipelineId !== "" && !firstStageId && (
                  <span className="text-muted" style={{ maxWidth: "28rem" }}>
                    У выбранной воронки нет этапов в Bitrix24 — нажмите «Обновить воронки и поля» или проверьте воронку в CRM.
                  </span>
                )}
                {toAddRows.length > 0 && pipelineId === "" && pipelines.length > 0 && (
                  <span className="text-muted" style={{ maxWidth: "28rem" }}>
                    В шаге 3 выберите воронку в списке (или снова нажмите «Обновить воронки и поля»).
                  </span>
                )}
                {toAddRows.length > 0 && pipelines.length === 0 && (
                  <span className="text-muted" style={{ maxWidth: "28rem" }}>
                    В шаге 3 нажмите «Загрузить воронки и поля сделки», чтобы подтянуть воронки из Bitrix24.
                  </span>
                )}
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
                    Создано сделок: {result.ok}. Ошибок: {result.errors.length}
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
