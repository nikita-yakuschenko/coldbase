/**
 * Проверка пароля и подпись сессии. Один пароль из env — доступ только для своих.
 */
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "coldbase_session";
const SECRET = process.env.COOLDBASE_SECRET ?? process.env.AMOCRM_CLIENT_SECRET ?? "coldbase-default-change-me";

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

/** Подпись для значения сессии (логин успешен). */
export function signSession(): string {
  return createHmac("sha256", SECRET).update("coldbase_logged_in").digest("hex");
}

/** Проверка cookie сессии. */
export function verifySession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const expected = signSession();
  if (cookieValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookieValue, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Включена ли проверка пароля (задан COOLDBASE_PASSWORD). */
export function isAuthRequired(): boolean {
  return Boolean(process.env.COOLDBASE_PASSWORD);
}

/** Проверка пароля из env. */
export function checkPassword(password: string): boolean {
  const envPassword = process.env.COOLDBASE_PASSWORD;
  if (!envPassword) return false;
  return password === envPassword;
}
