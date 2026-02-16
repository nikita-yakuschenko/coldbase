"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
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
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 p-8 shadow-xl backdrop-blur text-center">
          <h1 className="text-xl font-semibold text-white mb-2">coldbase</h1>
          <p className="text-white/60 mb-6">Вход не настроен. Перейдите на главную.</p>
          <a href="/" className="inline-block py-3 px-6 rounded-xl bg-gradient-to-r from-cyan-500/90 to-violet-500/90 text-white font-medium hover:opacity-90">
            На главную
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 p-8 shadow-xl backdrop-blur">
        <h1 className="text-xl font-semibold text-white mb-2">coldbase</h1>
        <p className="text-sm text-white/60 mb-6">{authRequired === null ? "Загрузка…" : "Введите пароль для входа"}</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            autoFocus
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || authRequired === null}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500/90 to-violet-500/90 text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
