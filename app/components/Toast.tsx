"use client";

import { useEffect } from "react";

export type ToastVariant = "error" | "warning" | "success" | "info";

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
  /** Авто-закрытие через ms (0 = не закрывать) */
  autoCloseMs?: number;
}

export function Toast({ message, variant = "info", onClose, autoCloseMs = 5000 }: ToastProps) {
  useEffect(() => {
    if (autoCloseMs <= 0) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [onClose, autoCloseMs]);

  return (
    <div
      role="alert"
      className={`toast toast--${variant}`}
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <span className="toast-message">{message}</span>
    </div>
  );
}
