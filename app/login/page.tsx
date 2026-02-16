"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => setAuthRequired(d.required))
      .catch(() => setAuthRequired(true));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка входа");
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  if (authRequired === false) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: "center" }}>
          <h1>coldbase</h1>
          <p className="subtitle">Вход не настроен. Перейдите на главную.</p>
          <a href="/" className="link-home">
            На главную
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>coldbase</h1>
        <p className="subtitle">
          {authRequired === null ? "Загрузка…" : "Введите пароль для входа"}
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            autoFocus
            required
            autoComplete="current-password"
          />
          {error && <p className="error">{error}</p>}
          <button
            type="submit"
            disabled={loading || authRequired === null}
            className="btn-login"
          >
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-page">
          <p style={{ color: "var(--text-muted)" }}>Загрузка…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
