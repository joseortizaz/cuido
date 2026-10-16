/**
 * Teléfonos dominicanos para WhatsApp. Lógica pura (scripts/test-whatsapp-reminders.ts).
 *
 * WhatsApp exige formato internacional (E.164): `+18096635279`. El personal teclea el número como
 * lo escribe el paciente («809-663-5279», «(829) 663 5279», «1 849 663 5279»…). Solo se aceptan
 * números dominicanos (códigos de área 809, 829 y 849: 10 dígitos más el 1 del país); cualquier
 * otra cosa devuelve null y el formulario pide corregirlo, en vez de enviar a un número equivocado.
 */

const DR_AREA_CODES = new Set(["809", "829", "849"]);

/** `+18096635279` o null si no es un número dominicano válido. */
export function normalizeDominicanPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && DR_AREA_CODES.has(digits.slice(0, 3))) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1" && DR_AREA_CODES.has(digits.slice(1, 4))) return `+${digits}`;
  return null;
}

/** `(809) 663-5279` para mostrar; si no es un número dominicano normalizado, lo devuelve tal cual. */
export function formatDominicanPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Mismo número sin importar cómo se escribió. */
export function samePhone(a: unknown, b: unknown): boolean {
  const na = normalizeDominicanPhone(a);
  return na !== null && na === normalizeDominicanPhone(b);
}
