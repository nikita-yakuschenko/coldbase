/**
 * Bitrix24 CRM: поиск дублей контактов, воронки сделок, создание контакта + сделки.
 */
import { callB24 } from "./b24Client";
import { normalizePhone } from "../normalizePhone";
import { getNoteColumns } from "../amo/amoService";

const DUPLICATE_DELAY_MS = 80;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function canonicalValue(value: string): string {
  const trimmed = value.trim();
  const norm = normalizePhone(trimmed);
  return norm.length >= 10 ? norm : trimmed;
}

function isEmailLike(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s.trim());
}

/** Поиск контактов по телефонам/email: для каждого значения — отдельный запрос (иначе Bitrix не возвращает соответствие значение→id). */
export async function searchContactsByValues(values: string[]): Promise<{ found: Set<string>; errors: string[] }> {
  const found = new Set<string>();
  const errors: string[] = [];
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    unique.add(canonicalValue(trimmed));
  }
  const list = Array.from(unique).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const canonical = list[i];
    if (i > 0) await delay(DUPLICATE_DELAY_MS);
    const email = canonical.includes("@");
    try {
      const result = await callB24<{ CONTACT?: number[]; LEAD?: number[]; COMPANY?: number[] }>(
        "crm.duplicate.findbycomm",
        {
          entity_type: "CONTACT",
          type: email ? "EMAIL" : "PHONE",
          values: [email ? canonical.trim() : canonical],
        }
      );
      const contacts = result?.CONTACT ?? [];
      if (contacts.length > 0) {
        found.add(canonical);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${canonical}: ${msg}`);
    }
  }
  return { found, errors };
}

/** Один запрос: id контакта по телефону/email, если уже есть в CRM (без создания дубля и лишних триггеров роботов). */
async function findExistingContactId(value: string, isEmail: boolean): Promise<number | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const forQuery = isEmail ? trimmed : canonicalValue(trimmed);
    const result = await callB24<{ CONTACT?: number[] }>("crm.duplicate.findbycomm", {
      entity_type: "CONTACT",
      type: isEmail ? "EMAIL" : "PHONE",
      values: [forQuery],
    });
    const ids = result?.CONTACT ?? [];
    return ids.length > 0 ? ids[0] : null;
  } catch {
    return null;
  }
}

/** Типы полей сделки: не маппим из Excel (связи с задачами/активностями — не создаём через импорт). */
const SKIP_DEAL_FIELD_TYPES = new Set(["crm_task", "crm_activity"]);

export interface B24Pipeline {
  id: number;
  name: string;
  statuses: { id: string; name: string }[];
}

/** Воронки сделок + стадии (crm.category.list + crm.dealcategory.stage.list). */
export async function getPipelinesWithStatuses(): Promise<B24Pipeline[]> {
  const catRes = await callB24<{ categories?: { id: number; name: string }[] }>("crm.category.list", {
    entityTypeId: 2,
  });
  const categories = catRes?.categories ?? [];
  const result: B24Pipeline[] = [];
  for (const c of categories) {
    const stages = await callB24<Array<{ STATUS_ID: string; NAME: string; SORT: number }>>(
      "crm.dealcategory.stage.list",
      { id: c.id }
    );
    const list = Array.isArray(stages) ? [...stages] : [];
    list.sort((a, b) => (a.SORT ?? 0) - (b.SORT ?? 0));
    result.push({
      id: c.id,
      name: c.name,
      statuses: list.map((s) => ({ id: s.STATUS_ID, name: s.NAME })),
    });
  }
  return result;
}

export interface B24DealField {
  id: string;
  name: string;
  type?: string;
}

/** Фрагмент описания поля из crm.deal.fields (Bitrix crm_rest_field_description). */
export interface B24DealFieldMeta {
  type?: string;
  title?: string;
  listLabel?: string;
  upperName?: string;
  isReadOnly?: boolean | string;
  items?: { ID: string; VALUE: string }[];
}

/** Поля, которые всегда выставляет приложение (воронка, стадия, связь с контактом). */
const DEAL_FIELD_KEYS_MANAGED_BY_APP = new Set([
  "ID",
  "CONTACT_ID",
  "CONTACT_IDS",
  "CATEGORY_ID",
  "STAGE_ID",
]);

function isDealFieldReadOnly(meta: B24DealFieldMeta | undefined): boolean {
  if (!meta) return false;
  const r = meta.isReadOnly;
  return r === true || r === "Y" || r === "1";
}

function fieldLabelFromMeta(key: string, meta: B24DealFieldMeta | undefined): string {
  if (!meta) return key;
  const raw = meta.listLabel || meta.title || meta.upperName || key;
  return String(raw).trim() || key;
}

/** Парсинг значения из Excel в формат, ожидаемый Bitrix для поля сделки. */
function parseDealFieldValueForAdd(
  fieldKey: string,
  raw: string,
  meta: B24DealFieldMeta | undefined
): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const type = (meta?.type || "").toLowerCase();
  if (SKIP_DEAL_FIELD_TYPES.has(type)) return undefined;

  if (fieldKey === "TITLE") return trimmed;

  if (!type && fieldKey === "OPPORTUNITY") {
    const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }

  if (type === "enumeration" || type === "crm_status") {
    const items = meta?.items;
    if (items?.length) {
      if (/^\d+$/.test(trimmed)) return trimmed;
      const hit = items.find(
        (i) => i.VALUE === trimmed || i.VALUE?.toLowerCase() === trimmed.toLowerCase()
      );
      if (hit) return hit.ID;
    }
    return trimmed;
  }

  if (type === "double" || type === "money") {
    const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }

  if (type === "integer") {
    const n = parseInt(trimmed.replace(/\s/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  if (type === "boolean") {
    const t = trimmed.toLowerCase();
    if (["y", "yes", "да", "1", "true", "+"].includes(t)) return "Y";
    if (["n", "no", "нет", "0", "false", "-"].includes(t)) return "N";
    return trimmed;
  }

  if (type === "date" || type === "datetime") {
    const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(trimmed);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      const iso = `${y.toString().padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return type === "datetime" ? `${iso}T00:00:00` : iso;
    }
    return trimmed;
  }

  if (
    type === "crm" ||
    type === "crm_company" ||
    type === "crm_contact" ||
    type === "crm_lead" ||
    type === "crm_deal" ||
    type === "user" ||
    type === "employee"
  ) {
    if (/^\d+$/.test(trimmed)) return trimmed;
    return undefined;
  }

  if (type === "file" || type === "disk_file" || type === "location" || type === "address") {
    return undefined;
  }

  return trimmed;
}

/** Поля сделки для маппинга: полный ответ crm.deal.fields (кроме только чтения и полей, задаваемых приложением). */
export async function getDealFieldsForMapping(): Promise<B24DealField[]> {
  const fields = await callB24<Record<string, B24DealFieldMeta>>("crm.deal.fields", {});
  const out: B24DealField[] = [];
  for (const [key, meta] of Object.entries(fields ?? {})) {
    if (DEAL_FIELD_KEYS_MANAGED_BY_APP.has(key)) continue;
    if (isDealFieldReadOnly(meta)) continue;
    const t = (meta?.type || "").toLowerCase();
    if (SKIP_DEAL_FIELD_TYPES.has(t)) continue;
    out.push({
      id: key,
      name: fieldLabelFromMeta(key, meta),
      type: meta?.type,
    });
  }
  out.sort((a, b) => {
    if (a.id === "TITLE") return -1;
    if (b.id === "TITLE") return 1;
    return a.name.localeCompare(b.name, "ru");
  });
  return out;
}

export interface CreateB24Row {
  row: Record<string, unknown>;
  mapping: Record<string, string>;
  category_id: number;
  stage_id: string;
  identifier_columns: string[];
  columns: string[];
}

/** Одна строка: контакт (телефон/email) + сделка в воронке. */
export async function createDealWithContact(
  row: CreateB24Row,
  fieldsMeta: Record<string, B24DealFieldMeta>
): Promise<void> {
  let identifierValue: string | undefined;
  let identifierIsEmail = false;
  for (const col of row.identifier_columns) {
    const v = String(row.row[col] ?? "").trim();
    if (v) {
      identifierValue = v;
      identifierIsEmail = isEmailLike(v);
      break;
    }
  }

  // Имя контакта не заполняем из названия сделки — только телефон/email (без имени в карточке).
  const contactFields: Record<string, unknown> = {
    NAME: "",
  };

  if (identifierValue) {
    if (identifierIsEmail) {
      contactFields.EMAIL = [{ VALUE: identifierValue.trim(), VALUE_TYPE: "WORK" }];
    } else {
      const phone = canonicalValue(identifierValue);
      contactFields.PHONE = [{ VALUE: phone.startsWith("+") ? phone : phone.replace(/^7(\d{10})$/, "+7$1"), VALUE_TYPE: "WORK" }];
    }
  }

  let contactId: number;
  if (identifierValue) {
    const existing = await findExistingContactId(identifierValue, identifierIsEmail);
    if (existing != null) {
      contactId = existing;
    } else {
      contactId = await callB24<number>("crm.contact.add", { fields: contactFields });
    }
  } else {
    contactId = await callB24<number>("crm.contact.add", { fields: contactFields });
  }

  const dealFields: Record<string, unknown> = {};

  for (const [fieldKey, columnKey] of Object.entries(row.mapping)) {
    if (!columnKey) continue;
    if (DEAL_FIELD_KEYS_MANAGED_BY_APP.has(fieldKey)) continue;
    const raw = row.row[columnKey];
    const value = raw != null ? String(raw).trim() : "";
    const meta = fieldsMeta[fieldKey];
    const parsed = parseDealFieldValueForAdd(fieldKey, value, meta);
    if (parsed !== undefined) {
      dealFields[fieldKey] = parsed;
    }
  }

  if (!dealFields.TITLE) {
    dealFields.TITLE = "Сделка";
  }

  const noteCols = getNoteColumns(row.columns);
  const noteParts = noteCols.map((col) => String(row.row[col] ?? "").trim()).filter(Boolean);
  if (noteParts.length > 0) {
    const extra = noteParts.join("\n\n");
    const prev = typeof dealFields.COMMENTS === "string" ? dealFields.COMMENTS + "\n\n" : "";
    dealFields.COMMENTS = prev + extra;
  }

  dealFields.CATEGORY_ID = row.category_id;
  dealFields.STAGE_ID = row.stage_id;
  dealFields.CONTACT_IDS = [contactId];

  // Только сделка CRM (crm.deal.add). Модуль «Задачи» (tasks.task.*) не вызывается.
  await callB24<number>("crm.deal.add", { fields: dealFields });
}

export async function createDealsBatch(rows: CreateB24Row[]): Promise<{ ok: number; errors: { rowIndex: number; message: string }[] }> {
  const fieldsMeta = await callB24<Record<string, B24DealFieldMeta>>("crm.deal.fields", {});
  const errors: { rowIndex: number; message: string }[] = [];
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await createDealWithContact(rows[i], fieldsMeta);
      ok += 1;
      if (i < rows.length - 1) await delay(50);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ rowIndex: i, message: msg });
    }
  }
  return { ok, errors };
}
