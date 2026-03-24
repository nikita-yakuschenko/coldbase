"use client";

import { useState, useRef, useEffect } from "react";
import { Settings } from "lucide-react";

/** Кнопка настроек и ссылка OAuth AmoCRM для шапки приложения. */
export function AmoSettingsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="settings-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn settings-btn"
        onClick={() => setOpen((v) => !v)}
        title="Настройки AmoCRM"
        aria-expanded={open}
      >
        <Settings />
      </button>
      {open && (
        <div className="settings-dropdown">
          <a href="/api/amo/auth" target="_blank" rel="noopener noreferrer" className="settings-dropdown-link">
            Авторизация AmoCRM
          </a>
          <p className="settings-dropdown-hint">
            Redirect URI в интеграции: <code>/api/amo/callback</code>
          </p>
        </div>
      )}
    </div>
  );
}
