/**
 * Публичный origin приложения для редиректов за reverse proxy.
 * Берём из AMOCRM_REDIRECT_URI (надёжнее req.url за Dokploy/Docker, где HOSTNAME=0.0.0.0).
 */
export function getAppOrigin(): string {
  const redirectUri = process.env.AMOCRM_REDIRECT_URI ?? "";
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // невалидный URI — fallback ниже
    }
  }
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl) {
    try {
      return new URL(appUrl).origin;
    } catch {
      return appUrl.replace(/\/$/, "");
    }
  }
  return "http://localhost:3000";
}

/** Абсолютный URL пути на публичном домене приложения. */
export function appUrl(path: string): URL {
  return new URL(path, getAppOrigin());
}
