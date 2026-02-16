"use client";

import { useState, useCallback } from "react";
import { LogOut } from "lucide-react";
import { normalizePhone } from "@/lib/normalizePhone";

type Parsed = { columns: string[]; rows: Record<string, unknown>[] };

export default function ColdbasePage() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [identifierColumns, setIdentifierColumns] = useState<string[]>([]);
  const [foundSet, setFoundSet] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: number; name: string; statuses: { id: number; name: string }[] }[]>([]);
  const [leadFields, setLeadFields] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [statusId, setStatusId] = useState<number | "">("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: { rowIndex: number; message: string }[] } | null>(null);
  const [uploadError, setUploadError] = useState("");

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setParsed(null);
    setFoundSet(new Set());
    setResult(null);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setParsed({ columns: data.columns, rows: data.rows });
      setIdentifierColumns(data.columns?.length ? [data.columns[0]] : []);
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
      setFoundSet(new Set(data.found ?? []));
    } catch (err) {
      setFoundSet(new Set());
      alert(err instanceof Error ? err.message : String(err));
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
      alert(err instanceof Error ? err.message : String(err));
    }
  }, [pipelineId]);

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
  const toAddRows = parsed?.rows.filter((r) => !rowIsExclusion(r)) ?? [];
  const exclusionRows = parsed?.rows.filter(rowIsExclusion) ?? [];

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
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [parsed, toAddRows, pipelineId, statusId, mapping, identifierColumns]);

  const currentPipeline = pipelineId ? pipelines.find((p) => p.id === pipelineId) : null;
  const currentStatuses = currentPipeline ? currentPipeline.statuses : [];

  return (
    <div className="app">
      <header className="header">
        <h1>coldbase</h1>
        <a href="/api/auth/logout" className="logout-btn" title="Выйти из аккаунта">
          <LogOut />
          <span>Выйти</span>
        </a>
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
            <p>{exclusionRows.length} записей</p>
            {exclusionRows.length > 0 && exclusionRows.length <= 100 && (
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
            <p>{toAddRows.length} записей</p>
            {toAddRows.length > 0 && toAddRows.length <= 100 && (
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
        <a href="/api/amo/auth" target="_blank" rel="noopener noreferrer">
          Авторизация AmoCRM
        </a>
        {" — "}
        после перехода по ссылке авторизуйтесь и вернитесь сюда. Redirect URI в настройках интеграции должен совпадать с <code>/api/amo/callback</code>.
      </footer>
    </div>
  );
}
