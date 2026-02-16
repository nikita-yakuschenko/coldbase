/**
 * Клиент AmoCRM: создание из env, подстановка токена, обновление при on_token.
 * Один портал — один экземпляр (получаем через getClient).
 */
import { Amo } from "@shevernitskiy/amo";
import { loadToken, saveToken, StoredToken } from "../tokenStore";

const subdomain = process.env.AMOCRM_SUBDOMAIN ?? "";
const clientId = process.env.AMOCRM_CLIENT_ID ?? "";
const clientSecret = process.env.AMOCRM_CLIENT_SECRET ?? "";
const redirectUri = process.env.AMOCRM_REDIRECT_URI ?? "";

let clientInstance: Amo | null = null;

/** Сбросить кэш клиента (при 401 — следующий getClient загрузит токен из файла заново). */
export function clearClient(): void {
  clientInstance = null;
}

function buildClient(token: StoredToken | null): Amo {
  const domain = `${subdomain || "your-subdomain"}.amocrm.ru`;
  const auth = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    ...(token
      ? {
          token_type: "Bearer" as const,
          expires_in: 86400,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: token.expires_at,
        }
      : { grant_type: "authorization_code" as const, code: "" }),
  };

  const amo = new Amo(domain, auth as ConstructorParameters<typeof Amo>[1], {
    on_token: async (newToken) => {
      const exp = (newToken as { expires_at?: number }).expires_at;
      const stored: StoredToken = {
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expires_at: exp != null ? exp : Date.now() + 86400 * 1000,
      };
      await saveToken(stored);
    },
  });

  return amo;
}

export async function getClient(): Promise<Amo> {
  if (clientInstance) return clientInstance;
  let token = await loadToken();
  if (!token && !subdomain) {
    throw new Error("AMOCRM: не задан subdomain или токен не сохранён");
  }
  if (token && token.expires_at < 1e12) {
    token = { ...token, expires_at: token.expires_at * 1000 };
  }
  clientInstance = buildClient(token);
  return clientInstance;
}

/** URL для OAuth: центральный хост (не subdomain). У subdomain.amocrm.ru/oauth был 404. */
const AMOCRM_OAUTH_BASE = "https://www.amocrm.ru";

export function getAuthUrl(): string {
  const redirect = redirectUri || "http://localhost:3000/api/amo/callback";
  const params = new URLSearchParams({
    client_id: clientId || "dummy",
    redirect_uri: redirect,
    response_type: "code",
    state: "coldbase",
  });
  return `${AMOCRM_OAUTH_BASE}/oauth?${params.toString()}`;
}
