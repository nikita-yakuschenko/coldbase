"use client";

import { useState } from "react";
import Image from "next/image";
import { LogOut } from "lucide-react";
import ColdbaseAmoTab from "@/app/components/ColdbaseAmoTab";
import ColdbaseBitrixTab from "@/app/components/ColdbaseBitrixTab";
import { AmoSettingsDropdown } from "@/app/components/AmoSettingsDropdown";

type CrmTab = "amo" | "bitrix";

export default function ColdbasePage() {
  const [tab, setTab] = useState<CrmTab>("amo");

  return (
    <div className="app">
      <header className="header header--with-tabs">
        <div className="header-brand">
          <div className="header-product-line">
            <Image src="/coldbase-icon.svg" alt="" width={40} height={40} className="header-logo-coldbase" priority />
            <h1>coldbase</h1>
            <span className="header-product-sep" aria-hidden="true">
              ×
            </span>
            {tab === "amo" ? (
              <Image src="/amocrm.svg" alt="AmoCRM" width={120} height={28} className="header-logo-crm" priority />
            ) : (
              <Image
                src="/bitrix24.svg"
                alt="Bitrix24"
                width={140}
                height={28}
                className="header-logo-crm header-logo-bitrix"
                priority
              />
            )}
          </div>
          <nav className="app-tabs" role="tablist" aria-label="CRM">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "amo"}
              id="tab-amo"
              className={`app-tab ${tab === "amo" ? "app-tab--active" : ""}`}
              onClick={() => setTab("amo")}
            >
              AmoCRM
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "bitrix"}
              id="tab-bitrix"
              className={`app-tab ${tab === "bitrix" ? "app-tab--active" : ""}`}
              onClick={() => setTab("bitrix")}
            >
              Bitrix24
            </button>
          </nav>
        </div>
        <div className="header-actions">
          {tab === "amo" && <AmoSettingsDropdown />}
          <a href="/api/auth/logout" className="logout-btn" title="Выйти из аккаунта">
            <LogOut />
            <span>Выйти</span>
          </a>
        </div>
      </header>

      <div className="tab-panel" role="tabpanel" aria-labelledby={tab === "amo" ? "tab-amo" : "tab-bitrix"}>
        {tab === "amo" && <ColdbaseAmoTab />}
        {tab === "bitrix" && <ColdbaseBitrixTab />}
      </div>

      <footer className="auth-footer">© module.team, 2026</footer>
    </div>
  );
}
