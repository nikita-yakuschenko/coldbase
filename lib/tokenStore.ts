/**
 * Хранение токена AmoCRM в файле (один портал).
 * При инициализации восстанавливаем; при изменении — сохраняем.
 */
import { promises as fs } from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "data", "amocrm-token.json");

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export async function loadToken(): Promise<StoredToken | null> {
  try {
    await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export async function saveToken(token: StoredToken): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), "utf-8");
}
