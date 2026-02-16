/**
 * Нормализация телефона для сравнения с AmoCRM: только цифры, 8 в начале заменяем на 7, 10 цифр дополняем до 11.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    return "7" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "7" + digits;
  }
  return digits;
}
