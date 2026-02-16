"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LogOut, Settings } from "lucide-react";
import { normalizePhone } from "@/lib/normalizePhone";
import { Toast, type ToastVariant } from "@/app/components/Toast";

type Parsed = { columns: string[]; rows: Record<string, unknown>[] };

const STORAGE_KEY = "coldbase_upload";

export default function ColdbasePage() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [identifierColumns, setIdentifierColumns] = useState<string[]>([]);
  const [foundSet, setFoundSet] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: number; name: string; statuses: { id: number; name: string }[] }[]>([]);
  const [leadFields, setLeadFields] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [statusId, setStatusId] = useState<number | "">("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: { rowIndex: number; message: string }[] } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
    setToast({ message, variant });
  }, []);

  // Восстановление загруженного файла из sessionStorage при перезагрузке
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { parsed: Parsed; identifierColumns: string[] };
      if (data.parsed?.columns?.length && Array.isArray(data.parsed.rows) && Array.isArray(data.identifierColumns)) {
        setParsed({ columns: data.parsed.columns, rows: data.parsed.rows });
        setIdentifierColumns(data.identifierColumns.filter((c) => data.parsed.columns.includes(c)));
      }
    } catch {
      // невалидные данные — игнорируем
    }
  }, []);

  // Сохраняем в sessionStorage при смене данных или выбора колонок
  useEffect(() => {
    if (typeof window === "undefined" || !parsed) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ parsed, identifierColumns }));
    } catch {
      // quota — не перезаписываем
    }
  }, [parsed, identifierColumns]);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [settingsOpen]);

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setParsed(null);
    setFoundSet(new Set());
    setHasSearched(false);
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      const nextParsed = { columns: data.columns, rows: data.rows };
      const nextCols = data.columns?.length ? [data.columns[0]] : [];
      setParsed(nextParsed);
      setIdentifierColumns(nextCols);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ parsed: nextParsed, identifierColumns: nextCols }));
      } catch {
        // quota или отключён storage — работаем без сохранения
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onSearch = useCallback(async () => {
    if (!parsed || identifierColumns.length === 0) return;
    setSearching(true);
    try {
      const valuesSet = new Set<string>();
      for (const r of parsed.rows) {
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
      const foundSetNew = new Set(data.found ?? []);
      setFoundSet(foundSetNew);
      setHasSearched(true);
      const errs = data.errors ?? [];
      // Считаем исключённые записи (строки), а не количество совпадений по телефонам
      const canonicalVal = (raw: string) => {
        const t = raw.trim();
        const n = normalizePhone(t);
        return n.length >= 10 ? n : t;
      };
      const excludedRecordCount = parsed.rows.filter((r) =>
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
  }, [parsed, identifierColumns]);

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
      if (pData.length && !pipelineId) setPipelineId(pData[0].id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }, [pipelineId, showToast]);

  const canonical = (raw: string) => {
    const t = raw.trim();
    const n = normalizePhone(t);
    return n.length >= 10 ? n : t;
  };
  const rowIsExclusion = (r: Record<string, unknown>) =>
    identifierColumns.some((col) => {
      const raw = String(r[col] ?? "").trim();
      return raw && foundSet.has(canonical(raw));
    });
  // Списки заполняем только после выполнения проверки в AmoCRM
  const toAddRows = hasSearched ? (parsed?.rows.filter((r) => !rowIsExclusion(r)) ?? []) : [];
  const exclusionRows = hasSearched ? (parsed?.rows.filter(rowIsExclusion) ?? []) : [];

  const onSubmit = useCallback(async () => {
    if (!parsed || toAddRows.length === 0 || !pipelineId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/amo/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: toAddRows,
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
  }, [parsed, toAddRows, pipelineId, statusId, mapping, identifierColumns, showToast]);

  const currentPipeline = pipelineId ? pipelines.find((p) => p.id === pipelineId) : null;
  const currentStatuses = currentPipeline ? currentPipeline.statuses : [];

  return (
    <div className="app">
      <header className="header">
        <h1>coldbase</h1>
        <div className="header-actions">
          <div className="settings-wrap" ref={settingsRef}>
            <button
              type="button"
              className="icon-btn settings-btn"
              onClick={() => setSettingsOpen((v) => !v)}
              title="Настройки"
              aria-expanded={settingsOpen}
            >
              <Settings />
            </button>
            {settingsOpen && (
              <div className="settings-dropdown">
                <a href="/api/amo/auth" target="_blank" rel="noopener noreferrer" className="settings-dropdown-link">
                  Авторизация AmoCRM
                </a>
                <p className="settings-dropdown-hint">Redirect URI в интеграции: <code>/api/amo/callback</code></p>
              </div>
            )}
          </div>
          <a href="/api/auth/logout" className="logout-btn" title="Выйти из аккаунта">
            <LogOut />
            <span>Выйти</span>
          </a>
        </div>
      </header>

      <section className="card">
        <h2>1. Загрузите Excel с холодной базой</h2>
        <div className="file-wrap">
          <input type="file" accept=".xlsx,.xls" onChange={onUpload} />
        </div>
        {uploadError && <p className="error">{uploadError}</p>}
        {parsed && (
          <p>Загружено колонок: {parsed.columns.length}, строк: {parsed.rows.length}</p>
        )}
      </section>

      {parsed && (
        <>
          <section className="card">
            <h2>2. Колонки для проверки в CRM</h2>
            <p>Можно несколько: рабочий, моб. телефон и т.д.</p>
            <div className="columns-grid">
              {parsed.columns.map((c, i) => (
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
            <button
              className="btn btn-primary"
              onClick={onSearch}
              disabled={searching || identifierColumns.length === 0}
            >
              {searching ? "Поиск…" : "Проверить в AmoCRM"}
            </button>
          </section>

          <section className="card">
            <h3>Исключения (уже есть в CRM)</h3>
            {!hasSearched ? (
              <p className="text-muted">Сначала нажмите «Проверить в AmoCRM»</p>
            ) : (
              <p>{exclusionRows.length} записей</p>
            )}
            {hasSearched && exclusionRows.length > 0 && exclusionRows.length <= 100 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {parsed.columns.slice(0, 5).map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exclusionRows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        {parsed.columns.slice(0, 5).map((c) => (
                          <td key={c}>{String(row[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3>К добавлению (лиды)</h3>
            {!hasSearched ? (
              <p className="text-muted">Сначала нажмите «Проверить в AmoCRM»</p>
            ) : (
              <p>{toAddRows.length} записей</p>
            )}
            {hasSearched && toAddRows.length > 0 && toAddRows.length <= 100 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {parsed.columns.slice(0, 5).map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {toAddRows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        {parsed.columns.slice(0, 5).map((c) => (
                          <td key={c}>{String(row[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>3. Воронка и маппинг</h2>
            <button type="button" className="btn btn-ghost" onClick={loadPipelinesAndFields}>
              Загрузить воронки и поля лида
            </button>
            {pipelines.length > 0 && (
              <>
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
                {currentStatuses.length > 0 && (
                  <>
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
                  </>
                )}
              </>
            )}
            {leadFields.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <label>Маппинг: поле лида ← колонка Excel</label>
                {leadFields.map((f) => (
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
                      {parsed.columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </section>

          {toAddRows.length > 0 && (
            <section className="card">
              <button
                className="btn btn-primary"
                onClick={onSubmit}
                disabled={submitting || !pipelineId}
              >
                {submitting ? "Отправка…" : "Загрузить в CRM"}
              </button>
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

      <footer className="auth-footer">
        © module.team, 2026
      </footer>

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
          autoCloseMs={6000}
        />
      )}
    </div>
  );
}
