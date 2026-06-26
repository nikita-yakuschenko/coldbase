/**
 * Конфигурация домена AmoCRM / Kommo.
 * AMOCRM_BASE_DOMAIN: amocrm.ru (по умолчанию) или kommo.com
 */
const subdomain = process.env.AMOCRM_SUBDOMAIN ?? "";
const baseDomain = (process.env.AMOCRM_BASE_DOMAIN ?? "amocrm.ru").replace(/^\.+/, "");

export function getAmoApiDomain(): string {
  return `${subdomain || "your-subdomain"}.${baseDomain}`;
}

/** Центральный хост OAuth (не subdomain — у subdomain/oauth бывает 404). */
export function getAmoOAuthBase(): string {
  return baseDomain === "kommo.com" ? "https://www.kommo.com" : "https://www.amocrm.ru";
}

export function getAmoCredentials() {
  return {
    subdomain,
    clientId: process.env.AMOCRM_CLIENT_ID ?? "",
    clientSecret: process.env.AMOCRM_CLIENT_SECRET ?? "",
    redirectUri: process.env.AMOCRM_REDIRECT_URI ?? "",
  };
}
