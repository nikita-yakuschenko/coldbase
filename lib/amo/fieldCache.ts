/** Кэш ID полей контакта (сбрасывается при clearClient). */
let contactPhoneFieldId: number | null = null;
let contactEmailFieldId: number | null = null;

export function resetContactFieldCache(): void {
  contactPhoneFieldId = null;
  contactEmailFieldId = null;
}

export function getCachedPhoneFieldId(): number | null {
  return contactPhoneFieldId;
}

export function setCachedPhoneFieldId(id: number): void {
  contactPhoneFieldId = id;
}

export function getCachedEmailFieldId(): number | null {
  return contactEmailFieldId;
}

export function setCachedEmailFieldId(id: number): void {
  contactEmailFieldId = id;
}
