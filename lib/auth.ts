/**
 * Проверка пароля и подпись сессии. Web Crypto API — работает в Edge (middleware) и Node.
 * Читаем env через ключ в рантайме, чтобы при сборке без COOLDBASE_PASSWORD не «запеклось» отключение авторизации.
 */
const COOKIE_NAME = "coldbase_session";

/** Чтение env в рантайме (ключ через конкатенацию, чтобы не заинлайнило при сборке). */
function getEnv(suffix: string): string | undefined {
  return process.env["COOLDBASE_" + suffix];
}

function getSecret(): string {
  return getEnv("SECRET") ?? process.env["AMOCRM_CLIENT_SECRET"] ?? "coldbase-default-change-me";
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Подпись для значения сессии (логин успешен). */
export async function signSession(): Promise<string> {
  return hmacHex(getSecret(), "coldbase_logged_in");
}

/** Сравнение строк за константное время. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Проверка cookie сессии. */
export async function verifySession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await hmacHex(getSecret(), "coldbase_logged_in");
  return constantTimeEqual(cookieValue, expected);
}

/** Включена ли проверка пароля (задан COOLDBASE_PASSWORD). Читаем в рантайме. */
export function isAuthRequired(): boolean {
  return Boolean(getEnv("PASSWORD"));
}

/** Проверка пароля из env. */
export function checkPassword(password: string): boolean {
  const envPassword = getEnv("PASSWORD");
  if (!envPassword) return false;
  return password === envPassword;
}
