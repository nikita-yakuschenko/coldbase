/**
 * Вызовы Bitrix24 REST по входящему вебхуку (B24_WEBHOOK_URL).
 */
export function getB24WebhookBase(): string {
  const u = process.env.B24_WEBHOOK_URL?.trim();
  if (!u) {
    throw new Error("B24_WEBHOOK_URL не задан в .env");
  }
  return u.replace(/\/$/, "");
}

type B24JsonResponse<T> = {
  result?: T;
  error?: string;
  error_description?: string;
};

export async function callB24<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const base = getB24WebhookBase();
  const url = `${base}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as B24JsonResponse<T>;
  if (data.error) {
    throw new Error(data.error_description || data.error || "Bitrix24 REST error");
  }
  return data.result as T;
}
