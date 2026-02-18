/**
 * Сервис AmoCRM: поиск контактов по значениям поля, воронки, создание лидов.
 */
import { getClient, clearClient } from "./client";
import { normalizePhone } from "../normalizePhone";

/** Канонический вид для поиска: телефон → нормализованный, иначе — trim */
function canonicalValue(value: string): string {
  const trimmed = value.trim();
  const norm = normalizePhone(trimmed);
  return norm.length >= 10 ? norm : trimmed;
}

const SEARCH_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Варианты query для телефона: в AmoCRM часто хранят как +7999... или 7999... */
function phoneQueryVariants(canonical: string): string[] {
  const variants = [canonical];
  if (/^7\d{10}$/.test(canonical)) {
    variants.push("+" + canonical);
  }
  return variants;
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
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("204") || msg.includes("No Content")) continue;
        errors.push(`${canonical}: ${msg}`);
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

/** ID поля «Телефон» у контактов (для addComplex). Берём первое поле типа multitext с кодом PHONE или первое подходящее. */
let cachedContactPhoneFieldId: number | null = null;

export async function getContactPhoneFieldId(): Promise<number | null> {
  if (cachedContactPhoneFieldId != null) return cachedContactPhoneFieldId;
  try {
    const amo = await getClient();
    const res = await amo.custom_fields.getCustomFields("contacts");
    const fields = (res as { _embedded?: { custom_fields: { id: number; type: string; code?: string }[] } })._embedded?.custom_fields ?? [];
    const phone = fields.find((f) => f.code === "PHONE" || f.type === "multitext");
    if (phone) cachedContactPhoneFieldId = phone.id;
  } catch {
    // игнорируем
  }
  return cachedContactPhoneFieldId;
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

/** Создание лидов: с контактом — addComplex (до 50 за запрос), без — addLeads (до 250). */
export async function createLeads(rows: CreateLeadRow[]): Promise<{ ok: number; errors: { rowIndex: number; message: string }[] }> {
  const amo = await getClient();
  const errors: { rowIndex: number; message: string }[] = [];
  let ok = 0;
  const hasContacts = rows.some((r) => r.identifierValue);
  const BATCH = hasContacts ? 50 : 250;
  const phoneFieldId = hasContacts ? await getContactPhoneFieldId() : null;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const leads: Record<string, unknown>[] = chunk.map((item) => {
      const lead: Record<string, unknown> = {
        pipeline_id: item.pipeline_id,
        status_id: item.status_id ?? undefined,
        name: "",
      };
      if (item.identifierValue && phoneFieldId != null) {
        (lead._embedded as Record<string, unknown>) = {
          contacts: [
            {
              custom_fields_values: [
                { field_id: phoneFieldId, values: [{ value: item.identifierValue }] },
              ],
            },
          ],
        };
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
    });

    try {
      let leadIds: number[] = [];
      if (hasContacts) {
        const response = await amo.lead.addComplex(leads as Parameters<typeof amo.lead.addComplex>[0]);
        leadIds = Array.isArray(response) ? response.map((r: { id: number }) => r.id) : [];
        const created = leadIds.length;
        ok += created;
        if (created < chunk.length) {
          for (let k = created; k < chunk.length; k++) errors.push({ rowIndex: i + k, message: "Не создан" });
        }
      } else {
        const response = await amo.lead.addLeads(leads as Parameters<typeof amo.lead.addLeads>[0]);
        const embedded = response._embedded?.leads ?? [];
        leadIds = embedded.map((l: { id: number }) => l.id);
        const created = leadIds.length;
        ok += created;
        if (created < chunk.length) {
          for (let k = created; k < chunk.length; k++) errors.push({ rowIndex: i + k, message: "Не создан" });
        }
      }
      // Примечания к сделкам: по одному на каждую непустую запись в noteTexts по порядку
      const notesPayload: { entity_id: number; note_type: "common"; params: { text: string } }[] = [];
      for (let k = 0; k < leadIds.length; k++) {
        const texts = chunk[k].noteTexts ?? [];
        for (const text of texts) {
          const t = String(text).trim();
          if (t) notesPayload.push({ entity_id: leadIds[k], note_type: "common", params: { text: t } });
        }
      }
      for (let n = 0; n < notesPayload.length; n += NOTES_BATCH) {
        const batch = notesPayload.slice(n, n + NOTES_BATCH);
        if (batch.length > 0) {
          try {
            await amo.note.addNotes("leads", batch);
          } catch {
            // лиды уже созданы, примечания частично не добавлены — не ломаем общий результат
          }
        }
      }
    } catch (e) {
      let msg: string;
      if (e && typeof e === "object" && "response" in e && e.response != null) {
        const r = (e as { response: unknown }).response;
        msg = typeof r === "object" && r !== null && "detail" in r
          ? String((r as { detail: unknown }).detail)
          : JSON.stringify(r);
      } else {
        msg = e instanceof Error ? e.message : String(e);
      }
      chunk.forEach((_, k) => errors.push({ rowIndex: i + k, message: msg }));
    }
  }

  return { ok, errors };
}
