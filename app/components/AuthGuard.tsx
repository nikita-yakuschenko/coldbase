"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (isLoginPage || pathname?.startsWith("/api/")) {
      setChecked(true);
      return;
    }
    fetch("/api/auth/check", { credentials: "include" })
      .then((res) => {
        if (res.status === 401) {
          const from = encodeURIComponent(pathname || "/");
          window.location.replace(`/login?from=${from}`);
          return;
        }
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [pathname, isLoginPage]);

  if (isLoginPage) return <>{children}</>;
  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f]">
        <p className="text-white/60">Проверка доступа…</p>
      </div>
    );
  }

  return <>{children}</>;
}
