/**
 * Сервис AmoCRM: поиск контактов по значениям поля, воронки, создание лидов.
 */
import { getClient, clearClient } from "./client";
import { normalizePhone } from "../normalizePhone";
import {
  getCachedPhoneFieldId,
  setCachedPhoneFieldId,
  getCachedEmailFieldId,
  setCachedEmailFieldId,
} from "./fieldCache";

/** Сообщение для UI: токен недействителен, нужна повторная авторизация */
export const AMOCRM_AUTH_INVALID_MESSAGE = "Токен AmoCRM недействителен или истёк. Выполните повторную авторизацию: Настройки → «Авторизация AmoCRM». Проверьте в .env совпадение AMOCRM_REDIRECT_URI с настройками интеграции и правильность AMOCRM_CLIENT_SECRET.";

/** Проверка ответа AmoCRM на ошибку OAuth (неверный/истёкший токен, неверный redirect_uri или client_secret). */
function isOAuthInvalidError(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("response" in e)) return false;
  const r = (e as { response?: unknown }).response;
  if (typeof r !== "object" || r === null) return false;
  const body = (r as { data?: unknown }).data ?? r;
  if (typeof body !== "object" || body === null) return false;
  const hint = "hint" in body ? String((body as { hint?: string }).hint) : "";
  const detail = "detail" in body ? String((body as { detail?: string }).detail) : "";
  return (
    /cannot decrypt the authorization code/i.test(hint) ||
    /authorization code/i.test(hint) ||
    /oauth/i.test(detail)
  );
}

function handleAmoAuthError(e: unknown): never {
  if (isOAuthInvalidError(e)) {
    clearClient();
    throw new Error(AMOCRM_AUTH_INVALID_MESSAGE);
  }
  const msg = e && typeof e === "object" && "response" in e
    ? JSON.stringify((e as { response: unknown }).response)
    : e instanceof Error ? e.message : String(e);
  if (msg.includes("401") || msg.includes("Unauthorized")) {
    clearClient();
  }
  throw e instanceof Error ? e : new Error(msg);
}

/** Канонический вид для поиска: телефон → нормализованный, иначе — trim */
function canonicalValue(value: string): string {
  const trimmed = value.trim();
  const norm = normalizePhone(trimmed);
  return norm.length >= 10 ? norm : trimmed;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Нормализация идентификатора для создания контакта (телефон в формате +7…, email в lower case). */
function normalizeIdentifier(value: string): { type: "phone" | "email"; value: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isEmail(trimmed)) {
    return { type: "email", value: trimmed.toLowerCase() };
  }
  const norm = normalizePhone(trimmed);
  if (norm.length >= 10) {
    const formatted = /^7\d{10}$/.test(norm) ? `+${norm}` : norm;
    return { type: "phone", value: formatted };
  }
  return { type: "phone", value: trimmed };
}

const SEARCH_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Варианты query для телефона: при 400 пробуем формат +7 (требуется API). */
function phoneQueryVariants(canonical: string): string[] {
  if (/^7\d{10}$/.test(canonical)) {
    return ["+" + canonical, canonical];
  }
  return [canonical];
}

/** Поиск контактов: канонические значения, для каждого — query; задержка между запросами (снижение 429). Возвращаем найденные и список ошибок. */
export async function searchContactsByValues(values: string[]): Promise<{ found: Set<string>; errors: string[] }> {
  const found = new Set<string>();
  const errors: string[] = [];
  const amo = await getClient();
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    unique.add(canonicalValue(trimmed));
  }
  const list = Array.from(unique).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const canonical = list[i];
    if (i > 0) await delay(SEARCH_DELAY_MS);
    const variants = /^\d+$/.test(canonical) && canonical.length >= 10 ? phoneQueryVariants(canonical) : [canonical];
    let matched = false;
    for (const query of variants) {
      try {
        const res = await amo.contact.getContacts({ query, limit: 1 });
        const contacts = res._embedded?.contacts ?? [];
        if (contacts.length > 0) {
          found.add(canonical);
          matched = true;
          break;
        }
      } catch (e) {
        if (isOAuthInvalidError(e)) {
          clearClient();
          throw new Error(AMOCRM_AUTH_INVALID_MESSAGE);
        }
        let msg = e instanceof Error ? e.message : String(e);
        if (e && typeof e === "object" && "response" in e) {
          const r = (e as { response?: unknown }).response;
          msg = msg || (typeof r === "object" && r !== null && "status" in r ? String((r as { status: number }).status) : JSON.stringify(r));
        }
        if (!msg) msg = String(e);
        if (msg.includes("204") || msg.includes("No Content")) continue;
        errors.push(`${canonical}: ${msg}`);
        if (errors.length === 1) {
          const res = e && typeof e === "object" && "response" in e ? (e as { response: unknown }).response : null;
          console.warn("[coldbase] contacts/search first error detail:", res ? JSON.stringify(res, null, 2) : e);
        }
        if (msg.includes("401") || msg.includes("Unauthorized")) {
          clearClient();
        }
        break;
      }
      if (variants.length > 1) await delay(SEARCH_DELAY_MS);
    }
    if (!matched && variants.length > 1) await delay(SEARCH_DELAY_MS);
  }
  if (process.env.NODE_ENV !== "test") {
    console.info("[coldbase] contacts/search: requested=" + list.length + ", found=" + found.size + ", errors=" + errors.length + (errors[0] ? " first=" + errors[0] : ""));
  }
  return { found, errors };
}

/** Воронки и статусы для выбора в UI */
export async function getPipelinesWithStatuses(): Promise<
  { id: number; name: string; statuses: { id: number; name: string }[] }[]
> {
  const amo = await getClient();
  const pipelinesRes = await amo.pipeline.getPipelines();
  const pipelines = pipelinesRes._embedded?.pipelines ?? [];
  const result: { id: number; name: string; statuses: { id: number; name: string }[] }[] = [];
  for (const p of pipelines) {
    const statusesRes = await amo.pipeline.getStatusesByPipelineId(p.id);
    const raw = statusesRes as { _embedded?: { statuses?: { id: number; name: string }[] } };
    const statuses = (raw._embedded?.statuses ?? []).map((s) => ({ id: s.id, name: s.name }));
    result.push({ id: p.id, name: p.name, statuses });
  }
  return result;
}

/** Поля лида: встроенные + кастомные для маппинга */
export async function getLeadFields(): Promise<
  { id: string; name: string; type?: string }[]
> {
  const amo = await getClient();
  const builtin: { id: string; name: string }[] = [
    { id: "name", name: "Название" },
    { id: "price", name: "Бюджет" },
  ];
  let custom: { id: string; name: string; type?: string }[] = [];
  try {
    const res = await amo.custom_fields.getCustomFields("leads");
    const fields = (res as { _embedded?: { custom_fields: { id: number; name: string; type: string }[] } })._embedded?.custom_fields ?? [];
    custom = fields.map((f) => ({ id: String(f.id), name: f.name, type: f.type }));
  } catch {
    // без кастомных полей маппинг всё равно работает
  }
  return [...builtin, ...custom];
}

async function getContactFieldIds(): Promise<{ phone: number | null; email: number | null }> {
  const cachedPhone = getCachedPhoneFieldId();
  const cachedEmail = getCachedEmailFieldId();
  if (cachedPhone != null || cachedEmail != null) {
    return { phone: cachedPhone, email: cachedEmail };
  }
  try {
    const amo = await getClient();
    const res = await amo.custom_fields.getCustomFields("contacts");
    const fields = (res as { _embedded?: { custom_fields: { id: number; code?: string }[] } })._embedded?.custom_fields ?? [];
    const phone = fields.find((f) => f.code === "PHONE");
    const email = fields.find((f) => f.code === "EMAIL");
    if (phone) setCachedPhoneFieldId(phone.id);
    if (email) setCachedEmailFieldId(email.id);
    return { phone: phone?.id ?? null, email: email?.id ?? null };
  } catch {
    return { phone: null, email: null };
  }
}

const NOTE_COLUMN_PATTERN = /^Примечание к сделке( \(\d+\))?$/;

export interface CreateLeadRow {
  /** Строка из Excel (ключ — колонка, значение — из ячейки) */
  row: Record<string, unknown>;
  /** Маппинг: поле лида (id или name) → колонка Excel */
  mapping: Record<string, string>;
  pipeline_id: number;
  status_id?: number;
  /** Значение идентификатора для создания/привязки контакта (например телефон) */
  identifierValue?: string;
  /** Тексты примечаний к сделке (по одному на колонку «Примечание к сделке» по порядку) */
  noteTexts?: string[];
}

/** Колонки «Примечание к сделке» в порядке появления (для использования в route). */
export function getNoteColumns(columns: string[]): string[] {
  return columns.filter((c) => c === "Примечание к сделке" || NOTE_COLUMN_PATTERN.test(c));
}

const NOTES_BATCH = 250;
const BATCH_WITH_CONTACT = 50;
const BATCH_WITHOUT_CONTACT = 250;

interface IndexedLeadRow {
  item: CreateLeadRow;
  rowIndex: number;
}

function buildLeadPayload(
  item: CreateLeadRow,
  contactFields: { phone: number | null; email: number | null }
): Record<string, unknown> {
  const lead: Record<string, unknown> = {
    pipeline_id: item.pipeline_id,
    status_id: item.status_id ?? undefined,
    name: "",
  };

  if (item.identifierValue) {
    const id = normalizeIdentifier(item.identifierValue);
    if (id) {
      const fieldId = id.type === "email" ? contactFields.email : contactFields.phone;
      if (fieldId != null) {
        (lead._embedded as Record<string, unknown>) = {
          contacts: [
            {
              custom_fields_values: [
                { field_id: fieldId, values: [{ value: id.value }] },
              ],
            },
          ],
        };
      }
    }
  }

  const custom_fields_values: { field_id: number; values: { value: string }[] }[] = [];
  for (const [fieldKey, columnKey] of Object.entries(item.mapping)) {
    const raw = item.row[columnKey];
    const value = raw != null ? String(raw).trim() : "";
    if (fieldKey === "name") {
      lead.name = value || "Лид";
    } else if (fieldKey === "price") {
      const num = Number(value);
      lead.price = isNaN(num) ? 0 : num;
    } else {
      const fieldId = Number(fieldKey);
      if (!isNaN(fieldId)) custom_fields_values.push({ field_id: fieldId, values: [{ value }] });
    }
  }
  if (custom_fields_values.length) lead.custom_fields_values = custom_fields_values;
  return lead;
}

function extractApiError(e: unknown): string {
  if (e && typeof e === "object" && "response" in e && e.response != null) {
    const r = (e as { response: unknown }).response;
    return typeof r === "object" && r !== null && "detail" in r
      ? String((r as { detail: unknown }).detail)
      : JSON.stringify(r);
  }
  return e instanceof Error ? e.message : String(e);
}

async function processLeadBatch(
  batch: IndexedLeadRow[],
  withContact: boolean,
  contactFields: { phone: number | null; email: number | null },
  warnings: string[]
): Promise<{ ok: number; errors: { rowIndex: number; message: string }[] }> {
  const amo = await getClient();
  const errors: { rowIndex: number; message: string }[] = [];
  let ok = 0;
  const chunkSize = withContact ? BATCH_WITH_CONTACT : BATCH_WITHOUT_CONTACT;

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const leads = chunk.map(({ item }) => buildLeadPayload(item, contactFields));

    try {
      let leadIds: number[] = [];
      if (withContact) {
        const response = await amo.lead.addComplex(leads as Parameters<typeof amo.lead.addComplex>[0]);
        leadIds = Array.isArray(response) ? response.map((r: { id: number }) => r.id) : [];
      } else {
        const response = await amo.lead.addLeads(leads as Parameters<typeof amo.lead.addLeads>[0]);
        const embedded = response._embedded?.leads ?? [];
        leadIds = embedded.map((l: { id: number }) => l.id);
      }

      const created = leadIds.length;
      ok += created;
      if (created < chunk.length) {
        for (let k = created; k < chunk.length; k++) {
          errors.push({ rowIndex: chunk[k].rowIndex, message: "Не создан (нет ответа от API)" });
        }
      }

      const notesPayload: { entity_id: number; note_type: "common"; params: { text: string } }[] = [];
      for (let k = 0; k < leadIds.length; k++) {
        const texts = chunk[k].item.noteTexts ?? [];
        for (const text of texts) {
          const t = String(text).trim();
          if (t) notesPayload.push({ entity_id: leadIds[k], note_type: "common", params: { text: t } });
        }
      }
      for (let n = 0; n < notesPayload.length; n += NOTES_BATCH) {
        const noteBatch = notesPayload.slice(n, n + NOTES_BATCH);
        if (noteBatch.length === 0) continue;
        try {
          await amo.note.addNotes("leads", noteBatch);
        } catch (noteErr) {
          warnings.push(`Примечания: не удалось добавить ${noteBatch.length} записей (${extractApiError(noteErr)})`);
        }
      }
    } catch (e) {
      if (isOAuthInvalidError(e)) {
        clearClient();
        throw new Error(AMOCRM_AUTH_INVALID_MESSAGE);
      }
      const msg = extractApiError(e);
      if (msg.includes("401") || msg.includes("Unauthorized")) {
        clearClient();
      }
      chunk.forEach(({ rowIndex }) => errors.push({ rowIndex, message: msg }));
    }
  }

  return { ok, errors };
}

/** Создание лидов: с контактом — addComplex (до 50 за запрос), без — addLeads (до 250). */
export async function createLeads(rows: CreateLeadRow[]): Promise<{
  ok: number;
  errors: { rowIndex: number; message: string }[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const errors: { rowIndex: number; message: string }[] = [];
  let ok = 0;

  const withContact: IndexedLeadRow[] = [];
  const withoutContact: IndexedLeadRow[] = [];
  rows.forEach((item, rowIndex) => {
    if (item.identifierValue) withContact.push({ item, rowIndex });
    else withoutContact.push({ item, rowIndex });
  });

  const contactFields = withContact.length > 0 ? await getContactFieldIds() : { phone: null, email: null };
  if (withContact.length > 0 && contactFields.phone == null && contactFields.email == null) {
    warnings.push("Не найдены поля PHONE/EMAIL у контактов — лиды будут созданы без привязки контакта");
    withoutContact.push(...withContact);
    withContact.length = 0;
  }

  try {
    if (withContact.length > 0) {
      const result = await processLeadBatch(withContact, true, contactFields, warnings);
      ok += result.ok;
      errors.push(...result.errors);
    }
    if (withoutContact.length > 0) {
      const result = await processLeadBatch(withoutContact, false, contactFields, warnings);
      ok += result.ok;
      errors.push(...result.errors);
    }
  } catch (e) {
    handleAmoAuthError(e);
  }

  return { ok, errors, warnings };
}
